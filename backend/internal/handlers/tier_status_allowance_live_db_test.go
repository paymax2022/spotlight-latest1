package handlers

// LIVE-DB test for GET /api/v1/me/tier's spend-allowance fields.
//
// The mobile checkout reads this endpoint to decline a spend BEFORE opening the
// Paystack gateway — without it a Tier 0 customer completes a card charge and only
// then gets a 403 from the fail-closed escrow gate, leaving money in a wallet they
// cannot spend and no order (see docs/adr/ADR-030).
//
// So the client depends on three things this test pins:
//  1. walletDisabled and dailyUsedKobo are actually emitted (the client must not have
//     to decode the (0, -1) / (0, 0) encoding of "unlimited" vs "disabled" itself);
//  2. the numbers come from the SAME tiers.GetUsage the debit gate is derived from;
//  3. today's real wallet debits are counted, so the remaining allowance shrinks as
//     the customer spends elsewhere in the app.
//
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"

	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

type tierStatusBody struct {
	Data struct {
		Tier           int    `json:"tier"`
		DailyLimitKobo *int64 `json:"dailyLimitKobo"`
		DailyUsedKobo  *int64 `json:"dailyUsedKobo"`
		RemainingKobo  *int64 `json:"remainingKobo"`
		WalletDisabled *bool  `json:"walletDisabled"`
	} `json:"data"`
}

// getTierStatusFor drives the handler for one user and decodes the payload.
func getTierStatusFor(t *testing.T, pool *pgxpool.Pool, userID string) tierStatusBody {
	t.Helper()
	gin.SetMode(gin.TestMode)
	h := NewKYCConnectHandler(kyc.NewService(pool), tiers.NewService(pool), nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/me/tier", nil)
	c.Set("user_id", userID)
	h.GetTierStatus(c)

	assert.Equal(t, http.StatusOK, w.Code)
	var body tierStatusBody
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	return body
}

func TestLiveDB_TierStatusReportsSpendAllowance(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; the tier-allowance endpoint requires a live database")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect test database: %v", err)
	}
	t.Cleanup(pool.Close)

	seed := func(kycTier int) string {
		id := uuid.New().String()
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
			t.Fatalf("seed auth user: %v", err)
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO user_profiles (id, email, kyc_tier) VALUES ($1,$2,$3)
			 ON CONFLICT (id) DO UPDATE SET kyc_tier = EXCLUDED.kyc_tier`,
			id, id+"@seed.test", kycTier); err != nil {
			t.Fatalf("seed profile: %v", err)
		}
		return id
	}

	t.Run("tier 0 reports walletDisabled explicitly", func(t *testing.T) {
		body := getTierStatusFor(t, pool, seed(0))
		assert.Equal(t, 0, body.Data.Tier)
		if assert.NotNil(t, body.Data.WalletDisabled, "walletDisabled must be emitted — the client blocks checkout on it") {
			assert.True(t, *body.Data.WalletDisabled)
		}
		if assert.NotNil(t, body.Data.RemainingKobo) {
			assert.Equal(t, int64(0), *body.Data.RemainingKobo, "a disabled wallet has no allowance")
		}
	})

	t.Run("tier 3 reports unlimited, not disabled", func(t *testing.T) {
		body := getTierStatusFor(t, pool, seed(3))
		if assert.NotNil(t, body.Data.WalletDisabled) {
			assert.False(t, *body.Data.WalletDisabled)
		}
		if assert.NotNil(t, body.Data.RemainingKobo) {
			// -1 is the unlimited sentinel. Reporting 0 here would make the client
			// decline every spend for the app's most-verified users.
			assert.Equal(t, int64(-1), *body.Data.RemainingKobo)
		}
	})

	t.Run("a capped tier reports the enforced limit and today's real spend", func(t *testing.T) {
		userID := seed(1)
		cfg := tiers.GetConfig(tiers.Tier1)

		body := getTierStatusFor(t, pool, userID)
		if assert.NotNil(t, body.Data.DailyLimitKobo) {
			assert.Equal(t, cfg.DailyDebitLimitKobo, *body.Data.DailyLimitKobo,
				"the advertised limit must be the one the debit gate enforces")
		}
		if assert.NotNil(t, body.Data.DailyUsedKobo) {
			assert.Equal(t, int64(0), *body.Data.DailyUsedKobo)
		}
		if assert.NotNil(t, body.Data.RemainingKobo) {
			assert.Equal(t, cfg.DailyDebitLimitKobo, *body.Data.RemainingKobo)
		}

		// Spend some of it for real, then re-read: the allowance must shrink by
		// exactly that amount, or a client pre-check would wave through a spend the
		// server is about to refuse.
		led := ledger.NewService(ledger.NewRepository(pool), nil)
		revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
		if err != nil {
			t.Fatalf("standing account: %v", err)
		}
		const spend int64 = 1_500_000
		if err := led.Credit(ctx, userID, "seed-fund", "tierfund-"+userID, revAcc.ID, 10_000_000); err != nil {
			t.Fatalf("fund wallet: %v", err)
		}
		if err := led.Debit(ctx, userID, "test:spend", "tierspend-"+userID, revAcc.ID, spend); err != nil {
			t.Fatalf("spend: %v", err)
		}

		after := getTierStatusFor(t, pool, userID)
		if assert.NotNil(t, after.Data.DailyUsedKobo) {
			assert.Equal(t, spend, *after.Data.DailyUsedKobo, "today's debit must count against the allowance")
		}
		if assert.NotNil(t, after.Data.RemainingKobo) {
			assert.Equal(t, cfg.DailyDebitLimitKobo-spend, *after.Data.RemainingKobo)
		}
	})
}
