package telemedicine_test

// LIVE-DB regression for the F1 audit finding: BookAppointment used to call
// settlement.Escrow — an UNGATED wallet debit — so a Tier-0 patient could
// book (and a Tier-1 patient could book past the daily cap). The booking now
// goes through settlement.EscrowWithGuard + EnforceCheckoutDebitLimitTx:
// the consumer-purchase daily-cap variant evaluated INSIDE the escrow tx.
// This pins:
//   - a Tier-0 patient is refused when the checkout allowance is OFF
//     (fail-closed — no wallet debit posts, no appointment row lands);
//   - the same Tier-0 patient books WITH the allowance on (ADR-043 — it is a
//     purchase, not a cash-out, so the capped checkout gate applies);
//   - a Tier-1 patient whose daily cap is already consumed is refused with
//     tiers.ErrDailyLimitExceeded;
//   - an unwired tier gate fails closed on ErrTierGateUnwired.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:54322/postgres"
//	go test ./internal/telemedicine/ -run TestLiveDB_BookAppointment_TierGate -v

import (
	"context"
	"errors"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/telemedicine"
	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_BookAppointment_TierGate(t *testing.T) {
	pool := uatFixesPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	settle := settlement.NewService(pool, led)

	// Tier-0 patient (fresh auth.users + default profile tier) — wallet debit
	// must be refused when the checkout allowance is off.
	doctorID, _, tier0Patient := seedApprovedDoctor(t, ctx, pool, led, 500_000)
	// seedApprovedDoctor promotes the patient to unlimited — put them back at
	// Tier 0 for this scenario.
	testsupport.SetKycTier(t, ctx, pool, tier0Patient, 0)

	svcNoAllowance := telemedicine.NewService(pool, settle).
		WithTiers(tiers.NewService(pool)) // checkout allowance OFF (prod flag default)
	bookReq := telemedicine.BookAppointmentRequest{
		DoctorID:       doctorID,
		ScheduledAt:    time.Now().Add(72 * time.Hour).Truncate(time.Second),
		IdempotencyKey: "tier0-off-" + uuid.New().String(),
	}
	if _, err := svcNoAllowance.BookAppointment(ctx, tier0Patient, bookReq); err == nil {
		t.Fatal("Tier-0 booking with the checkout allowance off must refuse")
	} else if !errors.Is(err, tiers.ErrWalletDisabled) && !errors.Is(err, tiers.ErrCheckoutAllowanceExceeded) {
		t.Fatalf("Tier-0 refusal must be a tier sentinel, got %v", err)
	}

	// The same Tier-0 patient books when the checkout allowance is ON — it is
	// a consumer purchase (ADR-043), capped at ₦10,000/purchase & ₦20,000/24h.
	svcAllowance := telemedicine.NewService(pool, settle).
		WithTiers(tiers.NewService(pool).WithCheckoutAllowance(true))
	bookReq.IdempotencyKey = "tier0-on-" + uuid.New().String()
	if _, err := svcAllowance.BookAppointment(ctx, tier0Patient, bookReq); err != nil {
		t.Fatalf("Tier-0 booking under the checkout allowance must succeed: %v", err)
	}

	// An UNWIRED tier gate fails closed — never a plain ungated escrow.
	// (Fresh slot: the successful booking above claimed 72h.)
	svcUnwired := telemedicine.NewService(pool, settle)
	bookReq.IdempotencyKey = "unwired-" + uuid.New().String()
	bookReq.ScheduledAt = time.Now().Add(74 * time.Hour).Truncate(time.Second)
	if _, err := svcUnwired.BookAppointment(ctx, tier0Patient, bookReq); !errors.Is(err, telemedicine.ErrTierGateUnwired) {
		t.Fatalf("unwired gate must fail closed on ErrTierGateUnwired, got %v", err)
	}

	// Tier-1 patient whose daily cap (₦50,000) is already consumed — a fresh
	// booking must refuse with ErrDailyLimitExceeded.
	doctorID2, _, tier1Patient := seedApprovedDoctor(t, ctx, pool, led, 500_000)
	testsupport.SetKycTier(t, ctx, pool, tier1Patient, 1)
	escrowAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow account: %v", err)
	}
	tiersSvc := tiers.NewService(pool)
	if err := led.DebitWithGuard(ctx, tier1Patient, "cap-consume", "cap-consume-"+uuid.New().String(), escrowAcc.ID, 5_000_000, tiersSvc.EnforceWalletDebitLimitTx); err != nil {
		t.Fatalf("consume daily cap: %v", err)
	}
	svcTier1 := telemedicine.NewService(pool, settle).WithTiers(tiersSvc)
	if _, err := svcTier1.BookAppointment(ctx, tier1Patient, telemedicine.BookAppointmentRequest{
		DoctorID:       doctorID2,
		ScheduledAt:    time.Now().Add(96 * time.Hour).Truncate(time.Second),
		IdempotencyKey: "overcap-" + uuid.New().String(),
	}); !errors.Is(err, tiers.ErrDailyLimitExceeded) {
		t.Fatalf("over-cap booking must fail on ErrDailyLimitExceeded, got %v", err)
	}
}
