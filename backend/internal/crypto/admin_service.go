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
// filtered by status (requested|pending|broadcast|confirmed|failed).
func (s *Service) AdminListWithdrawals(ctx context.Context, status string, limit, offset int) ([]AdminWithdrawal, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.AdminListWithdrawals(ctx, status, limit, offset)
}

// AdminDecideWithdrawal applies a compliance decision to a withdrawal:
//   - "approve": requested → pending (accepted for processing; the member/provider
//     path then drives pending → broadcast → confirmed).
//   - "reject":  requested → failed  (parked units returned to the owner's holding).
//
// The transition is guarded (WHERE status='requested'), so it is idempotent and can
// only act on a still-pending-review row; a second decision returns ErrInvalidTransition.
func (s *Service) AdminDecideWithdrawal(ctx context.Context, actorID, id, decision, note string) (*AdminWithdrawal, error) {
	var to, action string
	var returnUnits int64
	switch decision {
	case "approve":
		to, action = WithdrawalPending, "crypto.admin.withdraw.approve"
	case "reject":
		to, action = WithdrawalFailed, "crypto.admin.withdraw.reject"
	default:
		return nil, ErrBadRequest
	}

	// On reject we must return the parked units — read the row first to know how many.
	if decision == "reject" {
		cur, err := s.repo.AdminGetWithdrawal(ctx, id)
		if err != nil {
			return nil, err
		}
		if cur.Status != WithdrawalRequested {
			return nil, ErrInvalidTransition
		}
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

	out, err := s.repo.AdminTransitionWithdrawal(ctx, id, WithdrawalRequested, to, actorID, detail, failureReason, returnUnits)
	if err != nil {
		return nil, err
	}
	if err := s.audit.log(ctx, actorID, action, "crypto_withdrawal", id, note,
		nil, map[string]any{"decision": decision, "to_status": to, "units": out.Units}); err != nil {
		return nil, err
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

// AdminReconciliation summarises, per asset, the drift between the on-chain
// custodial balance and the ledger-side units the platform owes (holdings + parked
// withdrawals). There is NO custody/on-chain integration in this build, so
// onchain_units is reported EQUAL to ledger_units (drift 0, status "ok") — the shape
// is real and console-ready, and the moment a custody provider is wired the onchain
// leg replaces this identity.
//
// TODO(crypto-admin): source onchain_units from the custody provider (Fireblocks/
// BitGo balances) instead of mirroring ledger_units, so drift becomes meaningful.
// This intentionally does NOT import the finance ledger: the "ledger side" here is
// the crypto holding projections (which ARE the ledger's asset-unit legs) summed
// from crypto tables, keeping the module self-contained per the file scope.
func (s *Service) AdminReconciliation(ctx context.Context) (*ReconSummary, error) {
	assets, err := s.repo.ListAssets(ctx, false)
	if err != nil {
		return nil, err
	}
	held, err := s.repo.AdminHeldUnitsByAsset(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	rows := make([]ReconRow, 0, len(assets))
	breaks := 0
	for _, a := range assets {
		ledgerUnits := held[a.ID]
		onchainUnits := ledgerUnits // TODO: replace with custody-provider balance.
		drift := onchainUnits - ledgerUnits
		status := "ok"
		if drift != 0 {
			status = "break"
			breaks++
		}
		priceKobo, _ := s.price.PriceKobo(ctx, a.Symbol)
		rows = append(rows, ReconRow{
			AssetID: a.ID, Symbol: a.Symbol, MinorUnitScale: a.MinorUnitScale,
			LedgerUnits: ledgerUnits, OnchainUnits: onchainUnits, DriftUnits: drift,
			PriceKobo: priceKobo, Status: status, LastCheckedAt: now,
		})
	}
	return &ReconSummary{Rows: rows, Breaks: breaks, AsOf: now}, nil
}
