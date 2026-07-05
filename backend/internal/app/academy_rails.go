package app

import (
	"context"
	"time"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/integrations/rtc"
)

// academy_rails.go — real Paymax-rail adapters for the academy modules, replacing
// the dev stubs for the rails whose backing services exist:
//   - wallet collect/charge → finance/ledger (commerce.PaymentRail + edupay.CollectRail)
//   - live RTC token        → integrations/rtc (academy/live LiveRoomProvider)
//
// Intentionally NOT wired to real services (documented seams):
//   - BNPL, edupay DisburseRail, schools BillingRail, tutor PayoutRail — no clean
//     backing service / account model (BNPL + payout providers absent; school/tutor
//     payout accounts undefined). They keep their deterministic stubs.
//   - credentials RoleUpgrader — the earning-bridge handoff is correctly CLIENT-
//     initiated (mobile S7 deep-links into the existing Paymax role-upgrade/KYC
//     onboarding); auto-assigning a privileged role server-side would over-grant.
//     The backend only records the routed application.

// academyLedgerRail charges/collects on the Paymax wallet ledger: it debits the
// user's wallet into the academy escrow standing account. Idempotent on idemKey
// (the ledger enforces it). Satisfies commerce.PaymentRail (Charge) and
// edupay.CollectRail (Collect) structurally — no shadow ledger (golden rule 2/3).
type academyLedgerRail struct{ ledger *ledger.Service }

func (a academyLedgerRail) move(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (string, error) {
	acc, err := a.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return "", err
	}
	if err := a.ledger.Debit(ctx, userID, reference, idemKey, acc.ID, amountMinor); err != nil {
		return "", err
	}
	return idemKey, nil
}

// Charge satisfies commerce.PaymentRail.
func (a academyLedgerRail) Charge(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (string, error) {
	return a.move(ctx, userID, reference, idemKey, amountMinor)
}

// Collect satisfies edupay.CollectRail.
func (a academyLedgerRail) Collect(ctx context.Context, userID, reference, idemKey string, amountMinor int64) (string, error) {
	return a.move(ctx, userID, reference, idemKey, amountMinor)
}

// academyLiveRail mints real-time-media join tokens for live classes via the shared
// RTC issuer. The room is the session (deterministic channel name); the token is a
// short-lived Agora credential scoped to that channel + user. Satisfies
// academy/live.LiveRoomProvider structurally.
type academyLiveRail struct{ issuer *rtc.Issuer }

func (a academyLiveRail) CreateRoom(ctx context.Context, sessionID string) (string, error) {
	return "academy-live-" + sessionID, nil
}

func (a academyLiveRail) Token(ctx context.Context, roomRef, userID, role string) (string, error) {
	tok, _, err := a.issuer.Token(rtc.ProviderAgora, roomRef, userID, time.Hour)
	if err != nil {
		return "", err
	}
	return tok, nil
}
