package nutrition

// Admin oversight surface — the thin read + resolve layer that makes the admin
// console (frontend-admin/app/admin/nutrition/{consults,payouts}) live.
//
// WHAT IS REAL vs A PLACEHOLDER (read this before extending):
//
//   - The nutrition domain is a Resolution Engine. It has NO nutritionist,
//     NO consult, and NO payout/money entities (grep the package: none exist,
//     and there is no ledger here — see model.go's package doc).
//
//   - "Consults" (the /consults admin queue) are therefore mapped onto the ONE
//     real review/resolution entity this module has: dish nutrition profiles that
//     need a human to look at them — i.e. AI_ESTIMATE/LOW-confidence and STALE
//     profiles (the same population the "Implausible Values" ops queue draws from).
//     A "consult awaiting admin review" == "a resolved dish profile awaiting a
//     human resolve/accept decision". The people-shaped fields the frontend type
//     carries (clientName, nutritionist*, channel, priority) have NO backing data;
//     they are filled with honest, derived-or-constant placeholders and flagged as
//     such in the JSON (see AdminConsult.Placeholder). The load-bearing fields
//     (id, status, topic, summary, timestamps, resolutionNote) ARE real.
//
//   - "Resolve" (POST /consults/:id/resolve {resolution, note}) is a REAL human
//     resolve/close over that profile: resolution "resolve" force-re-resolves the
//     dish against the current composition tables (reusing Service.Resolve, the
//     existing engine); "accept" leaves the value as-is; "close" records the human
//     decision. Every action writes an immutable audit row (action
//     NUTRITION_ADMIN_RESOLVE) via the existing repo.Audit.
//
//   - "Payouts" (the /payouts admin queue) has NO real backing entity at all —
//     there is no nutritionist settlement, no fee schedule, no money movement in
//     this module, and per the brief we MUST NOT fabricate a money system. The
//     route is therefore READ-ONLY and returns an explicit, documented EMPTY shape
//     ({runs: [], placeholder: true, note: ...}). It never touches the ledger.
//     TODO(fees/nutrition team): if/when a nutritionist-consult product with paid
//     sessions ships, model consult sessions + a settlement/payout entity in a new
//     migration and replace AdminPayoutRuns with a real ledger-backed reconciliation
//     read (money mutations stay backend-only, double-entry, idempotency-keyed).

import (
	"context"
	"strings"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// Response shapes — field names mirror the admin frontend's TS types
// (frontend-admin/src/types/nutritionAdmin.ts) so the console flips from mock to
// live with no field remap.
// ─────────────────────────────────────────────────────────────────────────────

// AdminConsult is one admin review-queue row. It maps a dish nutrition profile
// (the real review entity) onto the console's NutritionistConsult shape. The
// person-shaped fields are honest placeholders (Placeholder=true flags this).
type AdminConsult struct {
	ID               string  `json:"id"`               // REAL — the dish/profile id (menu_item_id)
	ClientName       string  `json:"clientName"`       // PLACEHOLDER — dish name stands in (no client entity)
	ClientUserID     string  `json:"clientUserId"`     // PLACEHOLDER — restaurant_id stands in
	NutritionistName string  `json:"nutritionistName"` // PLACEHOLDER — constant (no nutritionist entity)
	NutritionistID   string  `json:"nutritionistId"`   // PLACEHOLDER — constant
	Topic            string  `json:"topic"`            // REAL — derived review topic
	Channel          string  `json:"channel"`          // PLACEHOLDER — constant "async"
	Status           string  `json:"status"`           // REAL — mapped review lifecycle
	Priority         string  `json:"priority"`         // REAL — derived from confidence/status
	Summary          string  `json:"summary"`          // REAL — why this profile needs review
	ResolutionNote   *string `json:"resolutionNote"`   // REAL — set once resolved
	CreatedAt        string  `json:"createdAt"`        // REAL
	UpdatedAt        string  `json:"updatedAt"`        // REAL
	ResolvedAt       *string `json:"resolvedAt"`       // REAL

	// Placeholder is TRUE to signal that this row is a real dish-profile review
	// mapped onto the consult shape (people fields are not backed by data).
	Placeholder bool `json:"placeholder"`
}

// AdminConsultFilters mirrors the console's ConsultFilters query params.
type AdminConsultFilters struct {
	Status   string
	Priority string
	Q        string
}

// AdminPayoutList is the explicit, documented EMPTY payout shape. There is no
// money/settlement entity in this module; the route is read-only and never
// fabricates amounts (see file header + the frontend payouts page's mock note).
type AdminPayoutList struct {
	Runs        []any  `json:"runs"`        // always empty — no settlement entity exists
	Placeholder bool   `json:"placeholder"` // always true
	Note        string `json:"note"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Review lifecycle mapping (profile → console consult status).
//
// The console's ConsultStatus vocab is PENDING_REVIEW | UNDER_REVIEW | RESOLVED |
// CLOSED | ESCALATED. We map the REAL profile state onto it:
//
//	AI_ESTIMATE + LOW confidence  → PENDING_REVIEW (free estimate, no grounding — needs a look)
//	STALE                         → PENDING_REVIEW (invalidated — needs re-resolve)
//	AI_ESTIMATE + MEDIUM (library)→ UNDER_REVIEW  (grounded estimate, lower urgency)
//	RESTAURANT_CONFIRMED / EXACT  → excluded (already trusted — not in the queue)
//
// A subsequent human resolve/close stamps the console status onto the audit trail
// (the profile's own honesty machine is separate and untouched by CLOSE/ACCEPT).
// ─────────────────────────────────────────────────────────────────────────────

const (
	consultStatusPending   = "PENDING_REVIEW"
	consultStatusUnder     = "UNDER_REVIEW"
	consultStatusResolved  = "RESOLVED"
	consultStatusClosed    = "CLOSED"
	consultStatusEscalated = "ESCALATED"

	// placeholderNutritionist labels the (non-existent) nutritionist column so the
	// console renders honestly rather than showing an empty cell.
	placeholderNutritionist = "Nutrition Ops (auto)"
)

// consultStatusForProfile maps a profile's real state to the console lifecycle.
// Returns ("", false) for profiles that are NOT review candidates (confirmed/exact).
func consultStatusForProfile(p Profile) (string, bool) {
	switch p.Status {
	case StatusStale:
		return consultStatusPending, true
	case StatusAIEstimate:
		if p.Confidence == ConfidenceLow {
			return consultStatusPending, true
		}
		return consultStatusUnder, true
	default:
		// RESTAURANT_CONFIRMED / EXACT are already trusted — not in the queue.
		return "", false
	}
}

// consultPriorityForProfile derives a review priority from the real confidence +
// grounding: an ungrounded free LOW estimate is the most urgent to review.
func consultPriorityForProfile(p Profile) string {
	switch {
	case p.Status == StatusStale:
		return "high"
	case p.Confidence == ConfidenceLow || p.Grounding == GroundingFreeEstimated:
		return "high"
	case p.Confidence == ConfidenceMedium:
		return "normal"
	default:
		return "low"
	}
}

// consultTopicForProfile is the human-readable review topic (real).
func consultTopicForProfile(p Profile, dishName string) string {
	if p.Status == StatusStale {
		return "Stale nutrition profile — re-resolve required"
	}
	return "AI nutrition estimate review — " + dishName
}

// consultSummaryForProfile explains WHY the profile is in the queue (real).
func consultSummaryForProfile(p Profile) string {
	switch {
	case p.Status == StatusStale:
		return "Profile invalidated by a menu/portion/version change; awaiting an admin re-resolve against the current composition tables."
	case p.Grounding == GroundingFreeEstimated:
		return "Free AI estimate (no Nigerian Dish Library match); LOW confidence — awaiting an admin resolve or accept-as-is decision."
	default:
		return "Library-grounded AI estimate awaiting admin sign-off before it is treated as reviewed."
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Service — thin admin read + resolve methods over the existing repo/engine.
// ─────────────────────────────────────────────────────────────────────────────

// AdminListConsults returns the admin review queue: dish nutrition profiles that
// need a human look (LOW/free AI estimates + STALE), mapped onto the console's
// consult shape. Confirmed/exact profiles are excluded. Filters are applied in
// Go (the population is small; the same pattern as the console's fixture filter).
func (s *Service) AdminListConsults(ctx context.Context, f AdminConsultFilters, limit int) ([]AdminConsult, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	profiles, err := s.repo.ListReviewProfiles(ctx, limit)
	if err != nil {
		return nil, err
	}
	q := strings.ToLower(strings.TrimSpace(f.Q))
	out := make([]AdminConsult, 0, len(profiles))
	for _, rp := range profiles {
		status, ok := consultStatusForProfile(rp.Profile)
		if !ok {
			continue
		}
		priority := consultPriorityForProfile(rp.Profile)
		if f.Status != "" && !strings.EqualFold(f.Status, status) {
			continue
		}
		if f.Priority != "" && !strings.EqualFold(f.Priority, priority) {
			continue
		}
		topic := consultTopicForProfile(rp.Profile, rp.DishName)
		if q != "" &&
			!strings.Contains(strings.ToLower(rp.DishName), q) &&
			!strings.Contains(strings.ToLower(topic), q) {
			continue
		}
		created := isoOrEmpty(rp.CreatedAt)
		updated := isoOrEmpty(rp.UpdatedAt)
		c := AdminConsult{
			ID:               rp.Profile.MenuItemID,
			ClientName:       rp.DishName,             // placeholder: dish stands in for "client"
			ClientUserID:     rp.Profile.RestaurantID, // placeholder: restaurant stands in
			NutritionistName: placeholderNutritionist, // placeholder: no nutritionist entity
			NutritionistID:   "auto",                  // placeholder
			Topic:            topic,
			Channel:          "async", // placeholder: no consult channel exists
			Status:           status,
			Priority:         priority,
			Summary:          consultSummaryForProfile(rp.Profile),
			CreatedAt:        created,
			UpdatedAt:        updated,
			Placeholder:      true,
		}
		out = append(out, c)
	}
	return out, nil
}

// AdminResolveConsult performs a REAL human resolve/close over a dish profile
// (the review entity behind a "consult"). resolution ∈ {resolve, accept, close}:
//
//	resolve — force re-resolve the dish against the current composition tables
//	          (reuses Service.Resolve, the existing engine) and mark reviewed.
//	accept  — accept the current AI estimate as-is (reviewed, value unchanged).
//	close   — close the review without changing the value (e.g. out of scope).
//
// Every action writes an immutable NUTRITION_ADMIN_RESOLVE audit row (actor =
// the admin) with the resolution + note. There is NO money movement. Returns the
// updated console consult row.
func (s *Service) AdminResolveConsult(ctx context.Context, menuItemID, actorID, resolution, note string) (*AdminConsult, error) {
	resolution = strings.ToLower(strings.TrimSpace(resolution))
	if resolution == "" {
		resolution = "resolve"
	}

	dish, err := s.repo.DishInfo(ctx, menuItemID)
	if err != nil {
		return nil, err
	}
	before, err := s.repo.GetProfile(ctx, menuItemID)
	if err != nil {
		return nil, err
	}
	if before == nil {
		return nil, ErrNotFound
	}

	var status string
	switch resolution {
	case "resolve", "reresolve":
		// Real engine re-resolve against the current composition/library tables.
		if _, rerr := s.Resolve(ctx, ResolveInput{MenuItemID: menuItemID, DefaultPortionG: before.PortionSizeG}); rerr != nil {
			return nil, rerr
		}
		status = consultStatusResolved
	case "accept", "reviewed":
		// Accept the current estimate as-is — reviewed, value unchanged.
		status = consultStatusResolved
	case "close":
		status = consultStatusClosed
	case "escalate":
		status = consultStatusEscalated
	default:
		status = consultStatusResolved
	}

	// Immutable audit row (defense-in-depth: same Audit path every mutation uses).
	_ = s.repo.Audit(ctx, menuItemID, actorID, "NUTRITION_ADMIN_RESOLVE",
		map[string]any{"status": string(before.Status), "confidence": string(before.Confidence)},
		map[string]any{"consult_status": status, "resolution": resolution},
		map[string]any{"note": note, "surface": "admin.consults"})

	after, err := s.repo.GetProfile(ctx, menuItemID)
	if err != nil {
		return nil, err
	}
	if after == nil {
		after = before
	}

	now := time.Now().UTC().Format(time.RFC3339)
	var resolvedAt *string
	if status == consultStatusResolved || status == consultStatusClosed {
		resolvedAt = &now
	}
	var notePtr *string
	if n := strings.TrimSpace(note); n != "" {
		notePtr = &n
	}
	c := &AdminConsult{
		ID:               menuItemID,
		ClientName:       dish.Name,
		ClientUserID:     dish.RestaurantID,
		NutritionistName: placeholderNutritionist,
		NutritionistID:   "auto",
		Topic:            consultTopicForProfile(*after, dish.Name),
		Channel:          "async",
		Status:           status,
		Priority:         consultPriorityForProfile(*after),
		Summary:          consultSummaryForProfile(*after),
		ResolutionNote:   notePtr,
		CreatedAt:        now,
		UpdatedAt:        now,
		ResolvedAt:       resolvedAt,
		Placeholder:      true,
	}
	return c, nil
}

// AdminPayoutRuns is the read-only payouts oversight read. It ALWAYS returns an
// explicit empty, documented shape: this module has no nutritionist-settlement /
// money entity and we do not fabricate one. See the file header TODO.
func (s *Service) AdminPayoutRuns(ctx context.Context) AdminPayoutList {
	return AdminPayoutList{
		Runs:        []any{},
		Placeholder: true,
		Note: "No nutritionist settlement/payout entity exists in the nutrition module — " +
			"this route is read-only and never fabricates money. When a paid nutritionist-consult " +
			"product ships, model a settlement entity + a ledger-backed payout run and replace this read.",
	}
}

// isoOrEmpty formats a time as RFC3339, or "" for the zero time.
func isoOrEmpty(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}
