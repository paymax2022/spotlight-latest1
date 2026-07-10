package crypto

import (
	"context"
	"time"
)

// This file adds the crypto ADMIN control-plane service methods used by the admin
// console (frontend-admin/app/admin/crypto/{withdrawals,swaps,addresses,
// reconciliation}). Reads are thin projections over existing tables; the two
// decision paths DRIVE the existing state machines (they invent no money movement):
//   - withdrawal decision: approve → requested→pending; reject → requested→failed
//     (parked units returned by the repo transition, exactly like the member reject).
//   - address decision:    approve → activate + verify; reject → deactivate + verify.
// Every decision emits an immutable audit event (crypto_audit_log) with the actor
// and operator note.

// ── Withdrawals (AML review queue) ───────────────────────────────────────────

// AdminListWithdrawals lists withdrawals across all users for AML review, optionally
// filtered by status (requested|pending_review|approved|broadcast|confirmed|failed).
// When no explicit status is supplied it defaults to the AML REVIEW QUEUE
// (status='pending_review') — the withdrawals parked and awaiting a compliance
// decision. Pass an explicit status to browse other states.
func (s *Service) AdminListWithdrawals(ctx context.Context, status string, limit, offset int) ([]AdminWithdrawal, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	if status == "" {
		// Default surface = the review queue (money parked, awaiting AML decision).
		status = WithdrawalPendingReview
	}
	return s.repo.AdminListWithdrawals(ctx, status, limit, offset)
}

// AdminDecideWithdrawal applies a compliance (AML) decision to a withdrawal that is
// PARKED for review. This is the gate: no money leaves before an approve here.
//   - "approve": pending_review → approved, then triggers the provider broadcast
//     (approved → broadcast) via broadcastApprovedWithdrawal. This is the ONLY path
//     that dispatches to the provider — the member create path stops at pending_review.
//   - "reject":  pending_review → failed  (parked units returned to the owner's holding).
//
// The transition is guarded (WHERE status='pending_review'), so it is idempotent and
// can only act on a still-in-review row; a second decision returns ErrInvalidTransition.
func (s *Service) AdminDecideWithdrawal(ctx context.Context, actorID, id, decision, note string) (*AdminWithdrawal, error) {
	var to, action string
	var returnUnits int64
	switch decision {
	case "approve":
		to, action = WithdrawalApproved, "crypto.admin.withdraw.approve"
	case "reject":
		to, action = WithdrawalFailed, "crypto.admin.withdraw.reject"
	default:
		return nil, ErrBadRequest
	}

	// Read the row first: guard it is still in review, and (on reject) learn how many
	// parked units to return.
	cur, err := s.repo.AdminGetWithdrawal(ctx, id)
	if err != nil {
		return nil, err
	}
	if cur.Status != WithdrawalPendingReview {
		return nil, ErrInvalidTransition
	}
	if decision == "reject" {
		returnUnits = cur.Units
	}

	detail := note
	if detail == "" {
		detail = "admin decision"
	}
	failureReason := ""
	if decision == "reject" {
		failureReason = note
	}

	// pending_review → approved | failed (guarded, idempotent, audited).
	out, err := s.repo.AdminTransitionWithdrawal(ctx, id, WithdrawalPendingReview, to, actorID, detail, failureReason, returnUnits)
	if err != nil {
		return nil, err
	}
	if err := s.audit.log(ctx, actorID, action, "crypto_withdrawal", id, note,
		nil, map[string]any{"decision": decision, "to_status": to, "units": out.Units}); err != nil {
		return nil, err
	}

	// On approve, the AML gate has cleared — NOW dispatch to the provider (the only
	// place a broadcast fires). broadcastApprovedWithdrawal drives approved→broadcast
	// (or approved→failed + unit return on provider reject) and audits the outcome.
	if decision == "approve" {
		bo, berr := s.broadcastApprovedWithdrawal(ctx, out)
		if berr != nil {
			return nil, berr
		}
		return bo, nil
	}
	return out, nil
}

// ── Swaps (monitoring) ───────────────────────────────────────────────────────

// AdminListSwaps returns recent swaps across all users. The frontend derives
// rate/volume/anomaly display from the returned rows.
func (s *Service) AdminListSwaps(ctx context.Context, limit, offset int) ([]SwapOrder, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.AdminListSwaps(ctx, limit, offset)
}

// ── Addresses (allow-list review) ────────────────────────────────────────────

// AdminListAddresses returns allow-list entries across all users for review,
// including inactive (pending/rejected) rows so the queue is complete.
func (s *Service) AdminListAddresses(ctx context.Context, review string, limit, offset int) ([]AdminAddress, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.AdminListAddresses(ctx, review, limit, offset)
}

// AdminDecideAddress approves (activate + verify) or rejects (deactivate + verify)
// an allow-list entry and audits the decision with the operator note.
func (s *Service) AdminDecideAddress(ctx context.Context, actorID, id, decision, note string) (*AdminAddress, error) {
	var approve bool
	var action string
	switch decision {
	case "approve":
		approve, action = true, "crypto.admin.address.approve"
	case "reject":
		approve, action = false, "crypto.admin.address.reject"
	default:
		return nil, ErrBadRequest
	}
	out, err := s.repo.AdminDecideAddress(ctx, id, approve)
	if err != nil {
		return nil, err
	}
	if err := s.audit.log(ctx, actorID, action, "crypto_address", id, note,
		nil, map[string]any{"decision": decision, "review_status": out.ReviewStatus}); err != nil {
		return nil, err
	}
	return out, nil
}

// ── Reconciliation (on-chain vs ledger drift) ────────────────────────────────

// AdminReconciliation summarises, per asset, the drift between the STORED on-chain
// custodial balance and the ledger-side units the platform owes (holdings + parked
// withdrawals). The on-chain side is now REAL: it reads the custodian-reported total
// from crypto_onchain_balances (fed by the custody-webhook seam, see onchain.go), so
// drift is meaningful rather than a forced identity.
//
// Per-asset status:
//   - no_feed → no custody row for this asset yet (absent from the on-chain store).
//     onchain_units is reported as 0 but this is NOT counted as a break — it means
//     "we have no on-chain data to reconcile against", which the console shows
//     distinctly so a missing feed is never mistaken for a healthy "ok".
//   - drift   → a custody row exists AND onchain_units != ledger_units. Counted as a
//     break to investigate.
//   - ok      → a custody row exists AND onchain_units == ledger_units.
//
// This is READ-ONLY: it reports drift, it never moves money. It intentionally does
// NOT import the finance ledger — the "ledger side" here is the crypto holding
// projections (which ARE the ledger's asset-unit legs) plus parked withdrawal units,
// summed from crypto tables (AdminHeldUnitsByAsset), keeping the module self-contained.
func (s *Service) AdminReconciliation(ctx context.Context) (*ReconSummary, error) {
	assets, err := s.repo.ListAssets(ctx, false)
	if err != nil {
		return nil, err
	}
	held, err := s.repo.AdminHeldUnitsByAsset(ctx)
	if err != nil {
		return nil, err
	}
	onchain, err := s.repo.OnchainUnitsByAsset(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	rows := make([]ReconRow, 0, len(assets))
	breaks := 0
	for _, a := range assets {
		ledgerUnits := held[a.ID]
		priceKobo, _ := s.price.PriceKobo(ctx, a.Symbol)

		row := ReconRow{
			AssetID: a.ID, Symbol: a.Symbol, MinorUnitScale: a.MinorUnitScale,
			LedgerUnits: ledgerUnits, PriceKobo: priceKobo, LastCheckedAt: now,
		}

		bal, ok := onchain[a.ID]
		if !ok {
			// No custody feed for this asset — report distinctly, do NOT count as a break.
			row.OnchainUnits = 0
			row.DriftUnits = 0
			row.Status = ReconStatusNoFeed
			rows = append(rows, row)
			continue
		}

		row.OnchainUnits = bal.OnchainUnits
		row.OnchainSource = bal.Source
		row.OnchainAsOf = &bal.AsOf
		row.DriftUnits = bal.OnchainUnits - ledgerUnits
		if row.DriftUnits != 0 {
			row.Status = ReconStatusDrift
			breaks++
		} else {
			row.Status = ReconStatusOK
		}
		rows = append(rows, row)
	}
	return &ReconSummary{Rows: rows, Breaks: breaks, AsOf: now}, nil
}
