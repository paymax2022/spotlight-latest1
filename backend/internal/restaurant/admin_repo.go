package restaurant

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// Admin (ops-console) READ models + service methods.
// These power the platform admin console surfaces (dispatch board, onboarding
// review, payout reconciliation) under /api/restaurant/admin/*. They are thin
// reads over the SAME tables the member/owner/rider flows already use — no new
// money movement is introduced here. Mutations (onboarding decision, manual
// assign) drive the EXISTING idempotent state transitions.
// All monetary amounts are integer minor units (kobo).

// AdminRider is a row in the platform rider roster. It reads the shared transport
// `drivers` pool (the same pool auto-dispatch offers deliveries to), plus the
// rider's currently-active food order (if any) so ops can see who is mid-delivery.
type AdminRider struct {
	ID            string     `json:"id"`   // drivers.user_id (the rider_id used on orders)
	Name          string     `json:"name"` // drivers.name
	Phone         *string    `json:"phone,omitempty"`
	Vehicle       string     `json:"vehicle"` // bike|car|foot (from drivers.vehicle_type)
	Status        string     `json:"status"`  // available|on_delivery|offline|suspended
	ActiveOrderID *string    `json:"active_order_id,omitempty"`
	Lat           *float64   `json:"lat,omitempty"`
	Lng           *float64   `json:"lng,omitempty"`
	Rating        *float64   `json:"rating,omitempty"`
	LastSeenAt    *time.Time `json:"last_seen_at,omitempty"`
}

// AdminDispatchOrder is an order needing dispatch attention: ready/searching for a
// rider, assigned, or picked_up but not yet delivered. Joined to its restaurant.
type AdminDispatchOrder struct {
	ID              string     `json:"id"`
	RestaurantID    string     `json:"restaurant_id"`
	RestaurantName  string     `json:"restaurant_name"`
	Status          string     `json:"status"`
	RiderID         *string    `json:"rider_id,omitempty"`
	RiderName       *string    `json:"rider_name,omitempty"`
	DeliveryAddr    string     `json:"delivery_address"`
	TotalKobo       int64      `json:"total_kobo"`
	DeliveryFeeKobo int64      `json:"delivery_fee_kobo"`
	ReadyAt         *time.Time `json:"ready_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	WaitingMinutes  int        `json:"waiting_minutes"`

	// Courier-sourcing state. This is a DISPATCH board and `dispatch_status` is
	// the column that actually drives it — the query filtered on it but never
	// projected it, so the console could not tell "ready, nobody looking yet"
	// from "actively searching" from "assigned to a rider", and its own
	// DispatchOrder type declared a field the server never sent.
	DispatchStatus string `json:"dispatch_status"`
	// RiderCandidateID is a rider the order has been OFFERED to who has not
	// accepted yet — distinct from RiderID (accepted). Without it an offer in
	// flight is indistinguishable from no offer at all.
	RiderCandidateID *string    `json:"rider_candidate_id,omitempty"`
	DispatchAttempts int        `json:"dispatch_attempts"`
	FirstOfferedAt   *time.Time `json:"first_offered_at,omitempty"`
}

// AdminApplication mirrors the restaurant merchant record for the onboarding/KYC
// review queue. The `restaurants` table is the merchant record; `is_open` gates
// order placement, so onboarding approval == opening the restaurant. Onboarding
// status is derived from is_open (no separate KYC column exists on `restaurants`
// yet — see report; a richer KYC record would live on onb_application).
type AdminApplication struct {
	ID             string `json:"id"`
	RestaurantName string `json:"restaurant_name"`
	OwnerID        string `json:"owner_id"`
	Address        string `json:"address,omitempty"`
	Status         string `json:"status"` // pending|in_review|approved|rejected (FOOD-010: derived from the REAL restaurant_kyb state, not is_open)
	// KYBStatus is the raw restaurants.kyb_status (E2E-PROV-020): Status alone
	// maps both "never submitted" (NULL) and "submitted, awaiting review" to
	// 'pending', which made them indistinguishable in the queue.
	KYBStatus   *string               `json:"kyb_status,omitempty"`
	Documents   []AdminApplicationDoc `json:"documents"` // restaurant_kyb_documents, keys signed for the reviewer
	SubmittedAt time.Time             `json:"submitted_at"`
	ReviewNote  *string               `json:"review_note,omitempty"`
}

// AdminPayoutRun is a READ-ONLY reconciliation view of settled food-delivery
// escrows grouped into a payout period. It is derived from the immutable
// `settlements` ledger-projection rows (module_type='food_delivery', status
// 'settled'); it does NOT represent a disbursement run and moves no money.
// See report: there is no payout-run service yet, so this is read-only.
type AdminPayoutRun struct {
	ID                string    `json:"id"`
	PayeeType         string    `json:"payee_type"` // restaurant (settled provider share)
	PeriodStart       string    `json:"period_start"`
	PeriodEnd         string    `json:"period_end"`
	Status            string    `json:"status"` // paid (already settled) — read-only
	LinesCount        int       `json:"lines_count"`
	TotalNetKobo      int64     `json:"total_net_kobo"`
	CreatedAt         time.Time `json:"created_at"`
	LedgerSettledKobo int64     `json:"ledger_settled_kobo"`
	Reconciled        bool      `json:"reconciled"`
}

// AdminListRiders returns the platform rider roster from the shared transport
// `drivers` pool, mapping transport status/verification to the console's rider
// status and attaching the rider's currently-active food order if any.
// mapRiderStatus maps the transport driver status + verification onto the ops
// console's rider status vocabulary (available|on_delivery|offline|suspended).
// NOT called in production any more (ADR-050) — the roster computes status in SQL, because
// it now filters, counts and pages on it and none of that can be done to a value
// derived after the rows come back. This is kept deliberately as the executable
// SPECIFICATION that riderStatusSQL is tested against
// (TestRiderStatusSQLMatchesGo). Do not delete it as dead code: it is what stops
// the SQL drifting the way the terminal-status set did.
func mapRiderStatus(transportStatus, verification string, onDelivery bool) string {
	switch verification {
	case "suspended", "rejected":
		return "suspended"
	}
	if onDelivery {
		return "on_delivery"
	}
	switch transportStatus {
	case "online":
		return "available"
	case "on_trip":
		return "on_delivery"
	default:
		return "offline"
	}
}

// AdminDispatchQueue lists orders awaiting or in dispatch (ready/searching for a
// rider, assigned, or picked_up but not delivered), newest first. waiting_minutes
// is time since the order became ready (from ready_at when set, else created_at).

// AdminListApplications lists restaurant merchant records for the onboarding/KYC
// review queue. status filters the derived onboarding status: an open restaurant
// is 'approved', a closed one is 'pending'. Empty status returns all.
// kybStatusToApplicationStatus maps the real restaurant_kyb/restaurants.kyb_status
// vocabulary to the admin console's expected application-status vocabulary
// (FOOD-010). A restaurant with no formal KYB row at all (kybStatus == nil) is
// "pending" — awaiting either an owner submission or a direct console decision,
// matching AdminDecideApplication's own "no row = the console decision IS the
// verification" precedent (see FOOD-003).
func kybStatusToApplicationStatus(kybStatus *string) string {
	if kybStatus == nil {
		return "pending"
	}
	switch KYBStatus(*kybStatus) {
	case KYBApproved:
		return "approved"
	case KYBRejected:
		return "rejected"
	case KYBUnderReview, KYBNeedsInfo:
		return "in_review"
	case KYBWithdrawn:
		return "withdrawn" // FOOD-UAT-A-014: applicant pulled it; not reviewable
	default: // KYBDraft, KYBSubmitted, or an unrecognized value
		return "pending"
	}
}

func (s *Service) AdminListApplications(ctx context.Context, status string) ([]AdminApplication, error) {
	// FOOD-010: this used to derive Status purely from restaurants.is_open, which
	// any owner can flip via SetAvailability — so a restaurant with a real KYB
	// submission sitting unreviewed showed as "approved" the moment its owner
	// opened it, and the frontend's in_review/rejected filters never matched
	// anything since this backend never emitted those values. Status is now
	// derived from the real kyb_status snapshot.
	const q = `
		SELECT r.id, r.name, r.owner_id, COALESCE(r.address,''), r.kyb_status, r.created_at
		FROM restaurants r
		ORDER BY r.created_at DESC`
	// One query for every outlet's documents, rather than one per row. A failure
	// here degrades to "no documents listed" instead of failing the whole queue:
	// the reviewer can still see and decide applications, and the error is logged.
	docRefs, derr := s.kybDocRefsByRestaurant(ctx)
	if derr != nil {
		log.Printf("[restaurant] admin applications: could not load KYB documents: %v", derr)
		docRefs = nil
	}
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminApplication
	for rows.Next() {
		var a AdminApplication
		var kybStatus *string
		if err := rows.Scan(&a.ID, &a.RestaurantName, &a.OwnerID, &a.Address, &kybStatus, &a.SubmittedAt); err != nil {
			return nil, err
		}
		a.Status = kybStatusToApplicationStatus(kybStatus)
		a.KYBStatus = kybStatus
		// No KYC review-note column exists on `restaurants` yet (see report); the
		// review note supplied on reject is delivered to the owner, not persisted.
		if status != "" && a.Status != status {
			continue
		}
		// Only for outlets actually being returned: signing mints a download URL for
		// an identity document, so a filtered queue must not sign the ones it drops.
		a.Documents = s.adminDocsFor(a.ID, docRefs[a.ID])
		out = append(out, a)
	}
	return out, rows.Err()
}

// AdminDecideApplication approves or rejects a restaurant onboarding application.
// Idempotent: approve opens the restaurant (is_open=true), reject closes it
// (is_open=false). It ALSO drives the `restaurants.kyb_status` snapshot the payout
// gate reads (see FOOD-003) — either through the real restaurant_kyb state machine
// when the owner has submitted one, or directly when they have not, since a console
// approve/reject is itself the verification decision in that case. No money
// movement. `note` is the reviewer's KYC note (recorded on the restaurant
// description-adjacent audit; required by the caller on reject).
func (s *Service) AdminDecideApplication(ctx context.Context, restaurantID, adminID, decision, note string) error {
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM restaurants WHERE id=$1)`, restaurantID).Scan(&exists); err != nil {
		return fmt.Errorf("restaurant: application lookup: %w", err)
	}
	if !exists {
		return errors.New("restaurant: application not found")
	}
	var target KYBStatus
	switch decision {
	case "approve":
		target = KYBApproved
	case "reject":
		target = KYBRejected
	case "needs_info":
		target = KYBNeedsInfo
	default:
		return fmt.Errorf("restaurant: invalid decision %q (want approve|reject|needs_info)", decision)
	}
	if decision != "approve" && note == "" {
		return fmt.Errorf("restaurant: a reviewer note is required to %s", decision)
	}

	var prevKYB string
	var prevOpen bool
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(kyb_status,''), COALESCE(is_open,false) FROM restaurants WHERE id=$1`,
		restaurantID).Scan(&prevKYB, &prevOpen)

	// When a KYB record exists, the decision must be a legal KYB transition and is
	// recorded on it (plus the restaurants.kyb_status snapshot payout gating reads).
	k, hasKYB, err := s.loadKYB(ctx, restaurantID)
	if err != nil {
		return err
	}
	if hasKYB {
		if !kybCanTransition(k.Status, target) {
			return fmt.Errorf("restaurant: cannot move KYB from %s to %s", k.Status, target)
		}
		if _, err := s.db.Exec(ctx,
			`UPDATE restaurant_kyb SET status=$2, decision_reason=NULLIF($3,''), reviewed_by=$4,
			        decided_at=now(), updated_at=now() WHERE restaurant_id=$1`,
			restaurantID, string(target), note, adminID); err != nil {
			return err
		}
		if _, err := s.db.Exec(ctx,
			`UPDATE restaurants SET kyb_status=$2, updated_at=now() WHERE id=$1`,
			restaurantID, string(target)); err != nil {
			return err
		}
	} else if decision == "needs_info" {
		return errors.New("restaurant: no KYB submission to request more info on")
	} else {
		// No formal restaurant_kyb row exists (the common case today — see FOOD-003:
		// the owner-facing KYB submission routes were never wired, so no restaurant
		// could create one). The admin console's approve/reject IS the verification
		// decision in that case — there is no separate KYB record to defer to — so the
		// kyb_status snapshot the payout gate reads (payout.go: `res.kyb_status =
		// 'approved'`) must still move here. Leaving it unset (the previous behavior)
		// let a console "approve" open the restaurant for orders while permanently
		// blocking its payouts with no way to ever clear "Business verification not
		// started". This also repairs any restaurant already stuck in that state by
		// simply re-running the decision.
		if _, err := s.db.Exec(ctx,
			`UPDATE restaurants SET kyb_status=$2, updated_at=now() WHERE id=$1`,
			restaurantID, string(target)); err != nil {
			return err
		}
	}

	switch decision {
	case "approve":
		if _, err := s.db.Exec(ctx,
			`UPDATE restaurants SET is_open=true, updated_at=now() WHERE id=$1`, restaurantID); err != nil {
			return err
		}
	case "reject":
		if _, err := s.db.Exec(ctx,
			`UPDATE restaurants SET is_open=false, updated_at=now() WHERE id=$1`, restaurantID); err != nil {
			return err
		}
	}
	// Durable audit (audit_logs sink, same as order transitions). Best-effort.
	if s.audit != nil {
		newOpen := prevOpen
		switch decision {
		case "approve":
			newOpen = true
		case "reject":
			newOpen = false
		}
		s.audit.LogAction(adminID, "", "restaurant.application."+decision, "restaurant", "restaurant", restaurantID,
			map[string]any{"kyb_status": prevKYB, "is_open": prevOpen},
			map[string]any{"kyb_status": string(target), "is_open": newOpen, "reason": note},
			"", "", "warning")
	}
	// Best-effort audit via the shared notifier (owner is informed of the decision).
	var owner string
	_ = s.db.QueryRow(ctx, `SELECT owner_id FROM restaurants WHERE id=$1`, restaurantID).Scan(&owner)
	if owner != "" {
		title := "Restaurant approved"
		body := "Your restaurant has been approved and is now live."
		switch decision {
		case "reject":
			title = "Restaurant application rejected"
			body = note
		case "needs_info":
			title = "More information needed"
			body = note
		}
		s.notify(ctx, Notification{UserID: owner, Event: EventOnboardingDecision, Title: title, Body: body,
			Data: map[string]any{"restaurant_id": restaurantID, "decision": decision, "admin_id": adminID}})
	}
	return nil
}

// AdminAssignRider is the ops-console manual assignment. It reuses the exact same
// offer mechanics as the owner-facing AssignRider (sets rider_candidate_id +
// notifies the rider), but authorizes the actor as the restaurant owner so a
// platform admin can assign on the merchant's behalf. Idempotent: re-assigning
// the same candidate simply re-offers. No money movement.
func (s *Service) AdminAssignRider(ctx context.Context, orderID, candidateID string) error {
	_, owner, _, err := s.orderParties(ctx, orderID)
	if err != nil {
		return err
	}
	// Drive the existing owner-authorized transition with the owner as actor.
	return s.AssignRider(ctx, orderID, owner, candidateID)
}

// AdminPayoutRuns returns a READ-ONLY reconciliation view of settled food-delivery
// escrows grouped by ISO week. Derived from the immutable `settlements` rows
// (module_type='food_delivery', status='settled'); provider_kobo is the restaurant
// share already credited. No disbursement is initiated — this is reconciliation
// only (see report: no payout-run service exists yet).
func (s *Service) AdminPayoutRuns(ctx context.Context) ([]AdminPayoutRun, error) {
	const q = `
		SELECT to_char(date_trunc('week', settled_at), 'YYYY-MM-DD')            AS period_start,
		       to_char(date_trunc('week', settled_at) + interval '6 days','YYYY-MM-DD') AS period_end,
		       count(*)                                                          AS lines_count,
		       COALESCE(sum(provider_kobo),0)                                    AS total_net_kobo,
		       COALESCE(sum(total_kobo),0)                                       AS ledger_settled_kobo,
		       min(settled_at)                                                   AS created_at
		FROM settlements
		WHERE module_type = 'food_delivery' AND status = 'settled' AND settled_at IS NOT NULL
		GROUP BY date_trunc('week', settled_at)
		ORDER BY date_trunc('week', settled_at) DESC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminPayoutRun
	for rows.Next() {
		var p AdminPayoutRun
		if err := rows.Scan(&p.PeriodStart, &p.PeriodEnd, &p.LinesCount,
			&p.TotalNetKobo, &p.LedgerSettledKobo, &p.CreatedAt); err != nil {
			return nil, err
		}
		p.ID = "food-restaurant-" + p.PeriodStart
		p.PayeeType = "restaurant"
		p.Status = "paid" // already settled to provider wallets via the ledger
		// Reconciled: net provider share never exceeds the settled escrow total.
		p.Reconciled = p.TotalNetKobo <= p.LedgerSettledKobo
		out = append(out, p)
	}
	return out, rows.Err()
}

// ── FOOD-UAT-A-008 / A-011: needs-changes + name-match (appended; the decide logic
// above, including its FIX-2 audit, is untouched) ───────────────────────────────

// nameStopwords are legal/generic words that say nothing about who owns a business.
var nameStopwords = map[string]bool{
	"ltd": true, "limited": true, "plc": true, "nig": true, "nigeria": true, "enterprises": true,
	"enterprise": true, "ventures": true, "services": true, "global": true, "and": true, "the": true,
	"restaurant": true, "restaurants": true, "kitchen": true, "foods": true, "food": true, "cafe": true,
	"bar": true, "grill": true, "company": true, "co": true, "inc": true, "rc": true, "bn": true,
}

// nameTokens lower-cases a name and returns its distinctive tokens (>=3 letters,
// not a generic/legal word).
func nameTokens(n string) map[string]bool {
	out := map[string]bool{}
	for _, f := range strings.FieldsFunc(strings.ToLower(n), func(r rune) bool {
		return !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9')
	}) {
		if len(f) >= 3 && !nameStopwords[f] {
			out[f] = true
		}
	}
	return out
}

func tokensIntersect(a, b map[string]bool) bool {
	for t := range a {
		if b[t] {
			return true
		}
	}
	return false
}

// namesRadicallyDiffer is the soft owner/business name-match control: true only when
// the settlement account holder shares NO distinctive token with either the KYB legal
// name or the storefront name. Empty inputs never warn (nothing to compare).
func namesRadicallyDiffer(storefront, legal, accountName string) bool {
	acc := nameTokens(accountName)
	if len(acc) == 0 {
		return false
	}
	base := nameTokens(legal)
	for t := range nameTokens(storefront) {
		base[t] = true
	}
	if len(base) == 0 {
		return false
	}
	return !tokensIntersect(acc, base)
}

// AdminNameMatchWarning reports whether the application's names look unrelated
// (FOOD-UAT-A-011). The schema has no owner_full_name / business_name columns, so the
// comparison is storefront name + KYB legal_name vs the settlement account_name — the
// pairing that matters for payouts. Advisory only: it never blocks a decision.
func (s *Service) AdminNameMatchWarning(ctx context.Context, restaurantID string) bool {
	var storefront, legal, acct string
	err := s.db.QueryRow(ctx,
		`SELECT COALESCE(r.name,''), COALESCE(k.legal_name,''), COALESCE(k.account_name,'')
		   FROM restaurants r LEFT JOIN restaurant_kyb k ON k.restaurant_id = r.id WHERE r.id=$1`,
		restaurantID).Scan(&storefront, &legal, &acct)
	if err != nil {
		return false
	}
	return namesRadicallyDiffer(storefront, legal, acct)
}

// AdminRequestChanges returns an application to the applicant for correction
// (FOOD-UAT-A-008). It is the needs_more_info transition (editable by the owner, who
// can then resubmit) driven through AdminDecideApplication so it carries the same
// transition rules, owner notification and FIX-2 audit record.
func (s *Service) AdminRequestChanges(ctx context.Context, restaurantID, adminID, reason string) error {
	if strings.TrimSpace(reason) == "" {
		return errors.New("restaurant: a reason is required to request changes")
	}
	return s.AdminDecideApplication(ctx, restaurantID, adminID, "needs_info", strings.TrimSpace(reason))
}

// AdminNeedsChanges → POST /api/restaurant/admin/onboarding/:id/needs-changes {reason}.
func (h *Handler) AdminNeedsChanges(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
		Note   string `json:"note"`
	}
	_ = c.ShouldBindJSON(&body)
	reason := body.Reason
	if reason == "" {
		reason = body.Note
	}
	if err := h.svc.AdminRequestChanges(c.Request.Context(), c.Param("id"), ginutil.UserID(c), reason); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": string(KYBNeedsInfo)})
}

// AdminDecideApplicationChecked wraps AdminDecideApplication to add the advisory
// name_match_warning (FOOD-UAT-A-011) to the response. Same body/path contract.
func (h *Handler) AdminDecideApplicationChecked(c *gin.Context) {
	var body struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	_ = c.ShouldBindJSON(&body)
	decision := c.Param("decision")
	if decision == "" || decision == "decision" {
		decision = body.Decision
	}
	id := c.Param("id")
	if err := h.svc.AdminDecideApplication(c.Request.Context(), id, ginutil.UserID(c), decision, body.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "name_match_warning": h.svc.AdminNameMatchWarning(c.Request.Context(), id)})
}
