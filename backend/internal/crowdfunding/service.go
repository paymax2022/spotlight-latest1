package crowdfunding

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
)

// Contribution pre-check rejections — business-rule errors on well-formed input
// (raised before any money moves). Handlers map these to 4xx, not 500.
var (
	ErrCampaignNotFound     = errors.New("crowdfunding: campaign not found")
	ErrCampaignPaused       = errors.New("crowdfunding: campaign is paused by its creator and is not accepting contributions")
	ErrCampaignNotAccepting = errors.New("crowdfunding: campaign is not accepting contributions")
	ErrCampaignNotReviewed  = errors.New("crowdfunding: campaign has not passed admin review")
	ErrCampaignDeadline     = errors.New("crowdfunding: campaign deadline has passed")
	// ErrCampaignNotPublishable marks a publish attempted on a campaign whose
	// review_status is not ACTIVE — i.e. one no creator action can take live.
	ErrCampaignNotPublishable = errors.New("crowdfunding: campaign is not in a publishable state")
	// ErrIdempotencyKeyConflict — the caller's Idempotency-Key is already used
	// by ANOTHER member's contribution (409). Replay lookups are scoped to the
	// caller, so a foreign key cannot replay a stranger's contribution back;
	// the surviving unique-violation on insert (or a foreign ledger-leg key at
	// escrow) is the durable proof of the clash — same convention as
	// finance/transfers' ErrIdempotencyKeyConflict.
	ErrIdempotencyKeyConflict = errors.New("crowdfunding: idempotency key already used by another contribution")
)

// walletDebitLimiter is the minimal seam the crowdfunding money path depends
// on for the fail-closed KYC-tier / daily-debit gate. *tiers.Service satisfies
// it in production; unit tests inject a fake via WithTiers. Modeled as a local
// interface — mirrors social's walletDebitLimiter. A contribution debits the
// contributor's wallet into escrow, so the STRICT gate is used: it is not a
// checkout purchase, so the Tier-0 checkout allowance (ADR-043) does NOT apply
// here.
type walletDebitLimiter interface {
	EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error
}

// ErrTierGateUnwired is returned when a Service has no tier gate — a nil gate
// must fail CLOSED, never debit ungated (mirrors social.ErrTierGateUnwired).
var ErrTierGateUnwired = errors.New("crowdfunding: money path requires a tier gate (not wired)")

// Service manages crowdfunding campaigns, contributions, and payouts/refunds.
type Service struct {
	db         *pgxpool.Pool
	ledger     *ledger.Service
	settlement *settlement.Service
	commission CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op
	tiers      walletDebitLimiter
}

// NewService builds the crowdfunding service. The tier-limit gate is
// constructed from the same pool (tiers.NewService needs only the DB), so no
// extra wiring is required at the call site — same convention as
// social.NewService. A nil pool leaves the gate nil, and enforceDebitLimit
// then fails closed via ErrTierGateUnwired.
func NewService(db *pgxpool.Pool, ledger *ledger.Service, settlement *settlement.Service) *Service {
	s := &Service{db: db, ledger: ledger, settlement: settlement}
	if db != nil {
		s.tiers = tiers.NewService(db)
	}
	return s
}

// WithTiers injects a pre-configured tier gate (app-wiring / tests). A nil
// argument is ignored so an unwired injection can never strip the gate.
func (s *Service) WithTiers(t walletDebitLimiter) *Service {
	if t != nil {
		s.tiers = t
	}
	return s
}

// enforceDebitLimit is the fail-closed guard applied before the Contribute
// escrow debit (E2E-FIN-046): the same EnforceWalletDebitLimit the canonical
// transfer rail (finance/transfers) runs. Tier 0 → ErrWalletDisabled, over
// daily cap → ErrDailyLimitExceeded, gate/db errors refuse, and a missing gate
// refuses via ErrTierGateUnwired. The error is propagated UNWRAPPED so the
// handler maps the tier sentinels to 403 via errors.Is.
func (s *Service) enforceDebitLimit(ctx context.Context, userID string, amountKobo int64) error {
	if s.tiers == nil {
		return ErrTierGateUnwired
	}
	return s.tiers.EnforceWalletDebitLimit(ctx, userID, amountKobo)
}

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module (§ profit registry). app-wiring injects a thin adapter over the finance
// commission service; when the commission feature is off (or no recorder is wired)
// the field is nil and recording is a silent no-op. Modeled as a LOCAL interface so
// crowdfunding never imports the commission package at compile time (mirrors the
// transport/restaurant/stays seams) — the adapter, which lives in app-wiring,
// discards the returned earning row and surfaces only the error.
// This records realized profit ONLY; it never moves money. Crowdfunding's own money
// movement (the 90/10 escrow split at Release) is unchanged, and the injected
// recorder is deliberately constructed WITHOUT a ledger so RecordFor never re-posts
// to the ledger (no double count of the commission revenue account) — it appends the
// immutable earning row used by profit reports.
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized Spotlight profit for a settled crowdfunding
// contribution. It is best-effort and MUST NEVER affect the caller's outcome: a nil
// recorder is a no-op, and any error is logged and swallowed so a profit-registry
// failure can never fail or reverse the campaign release. The recorded breakdown is
// resolved server-side from the central rate card; the contribution id doubles as
// the source ref + idempotency key so retries and reconciliation sweeps never
// double-count.
func (s *Service) recordCommissionSafe(ctx context.Context, category, service, subtype string, grossKobo int64,
	sourceRef string, userID *string) {
	if s.commission == nil || grossKobo <= 0 {
		return
	}
	if err := s.commission.RecordFor(ctx, category, service, subtype, grossKobo,
		"crowdfunding", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[crowdfunding] commission record (source=%s gross=%d) failed, continuing: %v", sourceRef, grossKobo, err)
	}
}

// Create creates a new campaign in draft state.
func (s *Service) Create(ctx context.Context, creatorID string, req CreateCampaignRequest) (*Campaign, error) {
	if req.Deadline.Before(time.Now()) {
		return nil, errors.New("crowdfunding: deadline must be in the future")
	}
	c := &Campaign{
		ID:          uuid.New().String(),
		CreatorID:   creatorID,
		Title:       req.Title,
		Description: req.Description,
		GoalKobo:    req.GoalKobo,
		Status:      "draft",
		Deadline:    req.Deadline,
		CoverURL:    req.CoverURL,
		CreatedAt:   time.Now(),
	}
	const q = `
		INSERT INTO campaigns (id, creator_id, title, description, goal_kobo, status, deadline, cover_url)
		VALUES ($1,$2,$3,$4,$5,'draft',$6,$7)`
	_, err := s.db.Exec(ctx, q, c.ID, c.CreatorID, c.Title, c.Description, c.GoalKobo, c.Deadline, c.CoverURL)
	return c, err
}

// Publish activates a campaign so it can receive contributions.
//
// A campaign only becomes publicly live through admin review: AdminDecide sets
// review_status='ACTIVE' AND status='active' together, and both discovery and
// Contribute gate on review_status. Flipping the legacy `status` column alone
// — what this used to do — acked {"ok":true} while the campaign stayed
// invisible and unfundable (V7b residual: 200 on a DRAFT that never left
// DRAFT). Publish is now honest about what it can do:
//   - approved-but-drifted (review_status='ACTIVE', status<>'active') → the
//     one real transition left here: heals the legacy column, returns nil;
//   - already live → nil (idempotent retry);
//   - DRAFT / PENDING_REVIEW / anything else → ErrCampaignNotPublishable, so a
//     no-op surfaces as 409 instead of a lying ack. Creators take drafts live
//     by submitting for review (POST /campaigns with submitForReview), not here.
func (s *Service) Publish(ctx context.Context, campaignID, creatorID string) error {
	var status, reviewStatus, ownerID string
	var deletedAt *time.Time
	err := s.db.QueryRow(ctx,
		`SELECT status, review_status, creator_id, deleted_at FROM campaigns WHERE id=$1`, campaignID).
		Scan(&status, &reviewStatus, &ownerID, &deletedAt)
	if err != nil {
		return ErrCampaignNotFound
	}
	// Not-owner and soft-deleted both report as not-found — publish must not
	// confirm a campaign's existence to a caller who doesn't own it.
	if deletedAt != nil || ownerID != creatorID {
		return ErrCampaignNotFound
	}
	if reviewStatus != "ACTIVE" {
		return fmt.Errorf("%w (review_status=%s)", ErrCampaignNotPublishable, reviewStatus)
	}
	if status == "active" {
		return nil // already live — idempotent
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE campaigns SET status='active', updated_at=NOW() WHERE id=$1`, campaignID); err != nil {
		return err
	}
	return nil
}

// Get returns a single campaign with the current raised total.
func (s *Service) Get(ctx context.Context, id string) (*Campaign, error) {
	const q = `
		SELECT c.id, c.creator_id, c.title, c.description, c.goal_kobo,
		       COALESCE(SUM(co.amount_kobo) FILTER (WHERE co.status IN ('escrowed','released')), 0) AS raised_kobo,
		       c.status, c.deadline, c.cover_url, c.created_at
		FROM campaigns c
		LEFT JOIN contributions co ON co.campaign_id = c.id
		WHERE c.id=$1 GROUP BY c.id`
	camp := &Campaign{}
	return camp, s.db.QueryRow(ctx, q, id).Scan(
		&camp.ID, &camp.CreatorID, &camp.Title, &camp.Description, &camp.GoalKobo,
		&camp.RaisedKobo, &camp.Status, &camp.Deadline, &camp.CoverURL, &camp.CreatedAt,
	)
}

// CreatorPayoutPct and PlatformFeePct are the crowdfunding split, and this is
// the ONLY authority for those numbers.
// The fee is DEDUCTED from the creator's payout, never added to the
// contributor's bill: a ₦1,000 contribution debits the contributor ₦1,000,
// pays the creator ₦900 and keeps ₦100. Anything that displays a fee — a
// checkout quote, a receipt — must describe that shape, and every past
// contribution is recorded under it.
// Two other places used to state a different number and neither moved money:
// the mobile client derived 2.5% and added it on top of the charge, and
// cf_fee_config.platform_fee_bps (admin-editable, currently 250) is read by the
// admin console and by nothing else. If the split is ever meant to become
// configurable, it is this constant that has to start reading that table —
// changing the table alone has no effect on any money.
const (
	CreatorPayoutPct = 0.90
	PlatformFeePct   = 0.10
)

// Contribute escrows a contributor's funds, then immediately settles the 90/10
// split so the money is available in the creator's wallet on arrival — no
// goal-gated hold ("keep what you raise", not all-or-nothing); refunds work via
// the clawback in refund.go. reviewStatus must already be ACTIVE — Publish()
// can flip status to 'active' without review, so both are checked.
func (s *Service) Contribute(ctx context.Context, campaignID, contributorID string, req ContributeRequest) (*Contribution, error) {
	// Idempotent replay: return the prior contribution unchanged, before any
	// state checks below. settlement.Escrow already deduplicates the ledger
	// posting itself (confirmed live: a replay produces zero extra ledger
	// entries) — but this function still called Escrow() again on every
	// retry and then tried to INSERT a second `contributions` row with the
	// same idempotency_key, which the table's own UNIQUE constraint rejected
	// as a raw 500 SQL error ("duplicate key value violates unique
	// constraint"). A caller retrying after a dropped response (the exact
	// scenario idempotency keys exist for) saw that error instead of the
	// success they'd already paid for. True idempotency means returning what
	// already happened, not re-validating current campaign state — a since-
	// paused/frozen campaign must not turn an already-paid contribution into
	// a fresh failure on replay.
	// The replay lookup is CALLER-SCOPED (contributor_id): a key another member
	// already used must NOT replay their contribution back to this caller —
	// that would leak their campaign/amount/settlement id. A foreign key misses
	// here and collides at the contributions unique constraint below → 409.
	if existing, ok, err := s.findContributionByIdempotencyKey(ctx, contributorID, req.IdempotencyKey); err != nil {
		return nil, err
	} else if ok {
		// A caller-scoped hit is a true replay ONLY when the request is the
		// same contribution. A key replayed against different material params
		// — another campaign or another amount — is idempotency-key misuse:
		// returning the stored row would ack a contribution this request never
		// made (a ₦Y caller told their ₦X pledge "succeeded", or a pledge to
		// campaign B answered with campaign A's receipt). Fail closed as the
		// same 409 a foreign-key clash gets (post-merge audit D4).
		if existing.CampaignID != campaignID || existing.AmountKobo != req.AmountKobo {
			return nil, ErrIdempotencyKeyConflict
		}
		return existing, nil
	}

	var status, reviewStatus, creatorID string
	var deadline time.Time
	var pausedAt, deletedAt *time.Time
	if err := s.db.QueryRow(ctx, `SELECT status, review_status, creator_id, deadline, paused_at, deleted_at FROM campaigns WHERE id=$1`, campaignID).
		Scan(&status, &reviewStatus, &creatorID, &deadline, &pausedAt, &deletedAt); err != nil {
		return nil, ErrCampaignNotFound
	}
	// A campaign the owner soft-deleted no longer exists as far as the product
	// is concerned; presenting it as "not found" matches every read surface.
	if deletedAt != nil {
		return nil, ErrCampaignNotFound
	}
	// Owner-paused campaigns stop TAKING money, not merely hiding from the
	// rails — otherwise anyone holding a direct link could keep funding a
	// campaign its creator has explicitly stopped.
	if pausedAt != nil {
		return nil, ErrCampaignPaused
	}
	if status != "active" {
		return nil, ErrCampaignNotAccepting
	}
	if reviewStatus != "ACTIVE" {
		return nil, ErrCampaignNotReviewed
	}
	if time.Now().After(deadline) {
		return nil, ErrCampaignDeadline
	}

	// Tier gate (fail-closed, E2E-FIN-046): the contribution debits the
	// contributor's wallet into escrow, so the same EnforceWalletDebitLimit the
	// transfer rail applies runs BEFORE money moves — a refused attempt posts
	// zero ledger legs and no contribution row. Replays already returned the
	// existing contribution above; the ledger probe covers the remaining case
	// (F2): a retry whose escrow legs committed but whose contribution row
	// never inserted converges through EscrowGated's in-tx replay verification.
	escrowPosted, err := s.ledger.Posted(ctx, req.IdempotencyKey+":escrow")
	if err != nil {
		return nil, err
	}
	if !escrowPosted {
		if err := s.enforceDebitLimit(ctx, contributorID, req.AmountKobo); err != nil {
			return nil, err
		}
	}

	ref := "campaign:" + campaignID + ":contributor:" + contributorID
	// EscrowGated re-runs the strict daily-cap check INSIDE the debit tx under
	// the wallet lock (F7) — the pooled gate above is advisory only.
	sett, err := s.settlement.EscrowGated(ctx, contributorID, ref, req.IdempotencyKey, "crowdfunding", req.AmountKobo)
	if err != nil {
		// ledger.ErrDuplicate on the ":escrow" leg with a caller-scoped replay
		// miss above means the key was already claimed by ANOTHER member's
		// contribution (or another module's transaction) — a cross-user reuse.
		// The ledger dedupe made it a no-op: no money moved for this caller.
		if errors.Is(err, ledger.ErrDuplicate) {
			return nil, ErrIdempotencyKeyConflict
		}
		return nil, fmt.Errorf("crowdfunding: escrow contribution: %w", err)
	}
	// Escrow dedupes on the GLOBAL key namespace: on a replay it returns the
	// EXISTING row's id but echoes THIS call's payer/module (only id, status
	// and total_kobo are re-read). So the stored row must be verified directly
	// before the contribution binds it — a settlement written by a different
	// payer, a different module, or for a different amount must never be
	// adopted (Settle() would then disburse money the contribution never
	// escrowed), and the escrow DEBIT LEG itself must sit on this caller's
	// wallet. verifyAdoptedSettlement owns the full check and fails closed.
	if err := s.verifyAdoptedSettlement(ctx, contributorID, req, sett.ID); err != nil {
		return nil, err
	}

	contrib := &Contribution{
		ID:             uuid.New().String(),
		CampaignID:     campaignID,
		ContributorID:  contributorID,
		AmountKobo:     req.AmountKobo,
		Status:         "escrowed",
		IdempotencyKey: req.IdempotencyKey,
		SettlementID:   sett.ID,
		CreatedAt:      time.Now(),
	}
	const insertC = `
		INSERT INTO contributions (id, campaign_id, contributor_id, amount_kobo, status, idempotency_key, settlement_id)
		VALUES ($1,$2,$3,$4,'escrowed',$5,$6)`
	if _, err := s.db.Exec(ctx, insertC, contrib.ID, contrib.CampaignID, contrib.ContributorID, contrib.AmountKobo, contrib.IdempotencyKey, contrib.SettlementID); err != nil {
		// A 23505 here with the caller-scoped replay miss above is the durable
		// signal of a cross-user key clash — contributions.idempotency_key is
		// UNIQUE. Report it as a conflict rather than a server fault (the M16
		// convention; a same-caller race loses nothing — the retry replays).
		if dbutil.IsUniqueViolation(err) {
			return nil, ErrIdempotencyKeyConflict
		}
		return nil, fmt.Errorf("crowdfunding: insert contribution: %w", err)
	}

	// Settle immediately (90% creator / 10% platform) rather than waiting for
	// Release() at goal-completion. The contribution itself is already recorded
	// (money is accounted for either way); a settle failure here is logged and
	// left 'escrowed' rather than failing the whole call — there is no unwind
	// for money the contributor has already paid.
	split := settlement.Split{ProviderID: creatorID, ProviderPct: CreatorPayoutPct, PlatformPct: PlatformFeePct}
	if err := s.settlement.Settle(ctx, contrib.SettlementID, split); err != nil {
		log.Printf("[crowdfunding] instant settle failed for contribution %s (left escrowed, needs manual sweep): %v", contrib.ID, err)
	} else if _, err := s.db.Exec(ctx, `UPDATE contributions SET status='released' WHERE id=$1`, contrib.ID); err != nil {
		log.Printf("[crowdfunding] settled contribution %s but failed to flip status to released: %v", contrib.ID, err)
	} else {
		contrib.Status = "released"
		creatorRef := creatorID
		s.recordCommissionSafe(ctx, "Community", "Crowdfunding", "", contrib.AmountKobo, contrib.ID, &creatorRef)
	}

	s.checkAndMarkFunded(ctx, campaignID)
	return contrib, nil
}

// findContributionByIdempotencyKey looks up a prior contribution by its
// idempotency key — scoped to THIS contributor. A key another member already
// used returns (nil, false, nil) here and is caught by the unique constraint
// on insert → ErrIdempotencyKeyConflict; an unscoped lookup would replay a
// stranger's contribution (leaking their campaign/amount/settlement id) on a
// guessed key. Returns (nil, false, nil) when none exists.
func (s *Service) findContributionByIdempotencyKey(ctx context.Context, contributorID, idempotencyKey string) (*Contribution, bool, error) {
	const q = `
		SELECT id, campaign_id, contributor_id, amount_kobo, status, idempotency_key, settlement_id, created_at
		FROM contributions WHERE idempotency_key = $1 AND contributor_id = $2`
	c := &Contribution{}
	err := s.db.QueryRow(ctx, q, idempotencyKey, contributorID).Scan(
		&c.ID, &c.CampaignID, &c.ContributorID, &c.AmountKobo, &c.Status, &c.IdempotencyKey, &c.SettlementID, &c.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, false, nil
		}
		return nil, false, err
	}
	return c, true, nil
}

// verifyAdoptedSettlement proves the settlements row Escrow resolved under
// this idempotency key is REALLY this caller's escrow before the contribution
// binds it. Three checks, all fail-closed (post-merge audit D1–D3):
//
//	D1 — the re-read itself must succeed. A scan error used to be swallowed
//	     (the ownership check fired only on rerr == nil), letting a
//	     contribution bind an unverified settlement id; now any re-read
//	     failure aborts the call.
//	D2 — row ownership is necessary but NOT sufficient: settlement.Escrow's
//	     ":escrow" ledger debit and its settlements-row insert are not atomic
//	     (service.go:34-73), so a crash between them leaves an ORPHAN debit a
//	     different caller can adopt by reusing the same key+amount — the row
//	     insert then lands carrying the NEW caller's payer_id and every
//	     row-level check passes while the money came from someone else's
//	     wallet. Provenance is therefore verified on the ledger itself: the
//	     "<key>:escrow:debit" entry (ledger.Debit appends ":debit" to the
//	     ":escrow" leg key Escrow passes) must exist on THIS caller's wallet
//	     with the settlement's amount — the same EntryAmount provenance probe
//	     wallet.VoteDebitAmount / social use.
//	D3 — the stored total_kobo must equal this request's amount: a replay
//	     that computed a different total under a reused key is a conflict,
//	     not an adoption.
//
// A row that fails any check is a cross-user/foreign key claim →
// ErrIdempotencyKeyConflict (409). Infra failures (re-read, wallet resolve,
// leg probe) are ordinary errors — the caller retries.
func (s *Service) verifyAdoptedSettlement(ctx context.Context, contributorID string, req ContributeRequest, settlementID string) error {
	var settPayer, settModule string
	var settTotalKobo int64
	if err := s.db.QueryRow(ctx,
		`SELECT payer_id, module_type, total_kobo FROM settlements WHERE id = $1`, settlementID,
	).Scan(&settPayer, &settModule, &settTotalKobo); err != nil {
		return fmt.Errorf("crowdfunding: re-read adopted settlement %s: %w", settlementID, err)
	}
	if settPayer != contributorID || settModule != "crowdfunding" || settTotalKobo != req.AmountKobo {
		return ErrIdempotencyKeyConflict
	}
	if s.ledger == nil {
		return errors.New("crowdfunding: ledger not wired — cannot verify escrow debit provenance")
	}
	payerWallet, err := s.ledger.GetOrCreateUserWallet(ctx, contributorID)
	if err != nil {
		return fmt.Errorf("crowdfunding: resolve payer wallet for escrow provenance: %w", err)
	}
	legAmount, legFound, err := s.ledger.EntryAmount(ctx, payerWallet.ID, req.IdempotencyKey+":escrow:debit")
	if err != nil {
		return fmt.Errorf("crowdfunding: probe escrow debit leg: %w", err)
	}
	if !legFound || legAmount != settTotalKobo {
		return ErrIdempotencyKeyConflict
	}
	return nil
}

// ReleaseResult reports what Release actually did. See RefundAll's identical
// pattern and comment for why this matters here too: Contribute() already
// instant-settles the 90/10 split on arrival (see its own comment), so by the
// time a campaign reaches 'funded' its contributions are typically already
// 'released', not 'escrowed' — a funded-campaign Release() call then finds
// nothing left to process. A bare success gave no way to tell "this call
// just paid everyone out" from "this call did nothing, it had already
// happened at contribute-time".
type ReleaseResult struct {
	ReleasedCount int   `json:"releasedCount"`
	ReleasedKobo  int64 `json:"releasedKobo"`
}

// Release pays out all escrowed contributions to the campaign creator.
// 90% to creator, 10% platform fee.
func (s *Service) Release(ctx context.Context, campaignID, creatorID string) (*ReleaseResult, error) {
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM campaigns WHERE id=$1 AND creator_id=$2`, campaignID, creatorID).Scan(&status); err != nil {
		return nil, errors.New("crowdfunding: campaign not found")
	}
	if status != "funded" {
		return nil, errors.New("crowdfunding: campaign must be in 'funded' state to release funds")
	}

	rows, err := s.db.Query(ctx, `SELECT id, settlement_id, contributor_id, amount_kobo FROM contributions WHERE campaign_id=$1 AND status='escrowed'`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type c struct {
		id, settlementID, contributorID string
		amountKobo                      int64
	}
	var contribs []c
	for rows.Next() {
		var entry c
		if err := rows.Scan(&entry.id, &entry.settlementID, &entry.contributorID, &entry.amountKobo); err != nil {
			return nil, err
		}
		contribs = append(contribs, entry)
	}
	rows.Close()

	split := settlement.Split{
		ProviderID:  creatorID,
		ProviderPct: CreatorPayoutPct,
		PlatformPct: PlatformFeePct,
	}
	result := &ReleaseResult{}
	for _, entry := range contribs {
		if err := s.settlement.Settle(ctx, entry.settlementID, split); err != nil {
			return nil, fmt.Errorf("crowdfunding: settle contribution %s: %w", entry.id, err)
		}
		if _, err := s.db.Exec(ctx, `UPDATE contributions SET status='released' WHERE id=$1`, entry.id); err != nil {
			return nil, fmt.Errorf("crowdfunding: mark contribution %s released: %w", entry.id, err)
		}
		result.ReleasedCount++
		result.ReleasedKobo += entry.amountKobo
		// Record realized Spotlight profit into the central Commission & Profit
		// registry. Release is crowdfunding's disbursement/settlement point — the
		// 90/10 split above already posted the 10% platform cut to the ledger, so this
		// is EARNING-ROW ONLY (the injected recorder has a nil ledger ⇒ no double post).
		// Best-effort + idempotent: the contribution id doubles as source ref +
		// idempotency key, so replays / reconciliation never double-count. gross = the
		// contribution amount the 10% platform fee applies to. A recorder failure is
		// logged and swallowed — it must NEVER fail or reverse the release above.
		contributorID := entry.contributorID
		s.recordCommissionSafe(ctx, "Community", "Crowdfunding", "", entry.amountKobo, entry.id, &contributorID)
	}
	return result, nil
}

// RefundResult reports what RefundAll actually did — refunded vs unrecoverable.
type RefundResult struct {
	RefundedCount int   `json:"refundedCount"`
	RefundedKobo  int64 `json:"refundedKobo"`
	// FailedCount / UnrefundedKobo count contributions the refund executor could
	// not reverse — most commonly a released contribution whose creator already
	// withdrew the payout. Reported, never silently dropped.
	FailedCount    int   `json:"failedCount"`
	UnrefundedKobo int64 `json:"unrefundedKobo"`
}

// RefundAll refunds every refundable contribution when a campaign fails or is
// cancelled, then marks the campaign failed. Contribute() instant-settles the
// 90/10 split, so "refundable" covers both states: 'escrowed' contributions are
// refunded from the escrow pool and 'released' ones clawed back from the
// creator's wallet + platform revenue (the shared executor in refund.go owns
// both mechanics). A per-contribution failure (e.g. creator already cashed out)
// is collected into FailedCount/UnrefundedKobo rather than aborting the sweep.
func (s *Service) RefundAll(ctx context.Context, campaignID, creatorID string) (*RefundResult, error) {
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM campaigns WHERE id=$1 AND creator_id=$2`, campaignID, creatorID).Scan(&status); err != nil {
		return nil, errors.New("crowdfunding: campaign not found")
	}
	if status == "funded" {
		return nil, errors.New("crowdfunding: cannot refund a funded campaign")
	}

	rows, err := s.db.Query(ctx, `SELECT id, amount_kobo FROM contributions WHERE campaign_id=$1 AND status IN ('escrowed','released')`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type c struct {
		id         string
		amountKobo int64
	}
	var contribs []c
	for rows.Next() {
		var entry c
		if err := rows.Scan(&entry.id, &entry.amountKobo); err != nil {
			return nil, err
		}
		contribs = append(contribs, entry)
	}
	rows.Close()

	result := &RefundResult{}
	for _, entry := range contribs {
		outcome, err := RefundContribution(ctx, s.db, s.ledger, s.settlement, entry.id, "campaign_cancelled")
		if err != nil {
			// Collect and continue — one unrefundable contribution must not
			// leave every other backer unpaid.
			result.FailedCount++
			result.UnrefundedKobo += entry.amountKobo
			continue
		}
		if outcome.AlreadyRefunded {
			continue
		}
		result.RefundedCount++
		result.RefundedKobo += outcome.RefundedKobo
	}
	if _, err := s.db.Exec(ctx, `UPDATE campaigns SET status='failed' WHERE id=$1`, campaignID); err != nil {
		return nil, err
	}
	// Audit the money mutation; best-effort — audit must never fail a refund.
	if _, err := s.db.Exec(ctx,
		`INSERT INTO cf_audit_logs (actor, action, target, ip) VALUES ($1,$2,$3,$4)`,
		creatorID, "campaign.refund", campaignID, ""); err != nil {
		log.Printf("[crowdfunding] audit write for campaign refund %s failed (refund itself committed): %v", campaignID, err)
	}
	return result, nil
}

func (s *Service) checkAndMarkFunded(ctx context.Context, campaignID string) {
	var goalKobo, raisedKobo int64
	_ = s.db.QueryRow(ctx, `
		SELECT c.goal_kobo,
		       COALESCE(SUM(co.amount_kobo) FILTER (WHERE co.status IN ('escrowed','released')), 0)
		FROM campaigns c LEFT JOIN contributions co ON co.campaign_id=c.id
		WHERE c.id=$1 GROUP BY c.id`, campaignID).Scan(&goalKobo, &raisedKobo)
	if raisedKobo >= goalKobo {
		_, _ = s.db.Exec(ctx, `UPDATE campaigns SET status='funded' WHERE id=$1 AND status='active'`, campaignID)
	}
}

// Campaign is a fundraising campaign with a goal amount and deadline.
type Campaign struct {
	ID          string    `json:"id"`
	CreatorID   string    `json:"creator_id"`
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	GoalKobo    int64     `json:"goal_kobo"`
	RaisedKobo  int64     `json:"raised_kobo"`
	Status      string    `json:"status"` // draft | active | funded | failed | cancelled
	Deadline    time.Time `json:"deadline"`
	CoverURL    *string   `json:"cover_url,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// Contribution is a single pledge to a campaign.
type Contribution struct {
	ID             string    `json:"id"`
	CampaignID     string    `json:"campaign_id"`
	ContributorID  string    `json:"contributor_id"`
	AmountKobo     int64     `json:"amount_kobo"`
	Status         string    `json:"status"` // escrowed | released | refunded
	IdempotencyKey string    `json:"idempotency_key"`
	SettlementID   string    `json:"settlement_id"`
	CreatedAt      time.Time `json:"created_at"`
}

// CreateCampaignRequest is the body for POST /crowdfunding/campaigns.
type CreateCampaignRequest struct {
	Title       string    `json:"title" binding:"required,min=2,max=200"`
	Description string    `json:"description"`
	GoalKobo    int64     `json:"goal_kobo" binding:"required,min=100"`
	Deadline    time.Time `json:"deadline" binding:"required"`
	CoverURL    *string   `json:"cover_url,omitempty"`
}

// ContributeRequest is the body for POST /crowdfunding/campaigns/:id/contribute.
type ContributeRequest struct {
	AmountKobo     int64  `json:"amount_kobo" binding:"required,min=100"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}
