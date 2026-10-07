package transfers

// Live-DB regression tests for the ledger-audit defects on the payout leg:
//
//   - CRITICAL: bank_transfers never stored the full NUBAN — only
//     account_number_last4 — so the provider leg sent a 4-digit "account
//     number". These tests capture the provider's RecipientRequest and assert
//     it carries the FULL account number.
//   - HIGH (claim-window race): a reversal/settle landing between the
//     reserve/fund commit and the leg claim must stop the provider call — the
//     non-terminal guard re-checks status under the lock on a fresh read.
//   - HIGH (foreign-leg absorb): ON CONFLICT DO NOTHING must not silently
//     absorb a DIFFERENT leg under the same idempotency key — mismatch fails
//     the transaction; an identical pre-existing leg is a replay.
//   - MED-3: AdminRetry on provider_initiated must query the provider by
//     provider_transfer_ref instead of blindly re-firing (Paystack does not
//     dedupe on our reference).
//
// Bring-up: same as atomicity_live_db_test.go — TEST_DATABASE_URL only.

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/disbursement"
)

// recordingProvider is a DisbursementProvider stub that captures every
// RecipientRequest / PayoutRequest it receives, and answers GetTransferStatus
// from a scriptable field. It is registered under a real provider's name
// ("paystack") because bank_transfers.provider has a CHECK constraint.
type recordingProvider struct {
	name string

	mu           sync.Mutex
	recipientReq []provider.RecipientRequest
	payoutReq    []provider.PayoutRequest

	// Scripted GetTransferStatus answer for the provider_initiated reconcile.
	transferStatus    *provider.PayoutStatus
	transferStatusErr error
	statusCalls       int
}

func (r *recordingProvider) Name() string { return r.name }

func (r *recordingProvider) ListBanks(context.Context) ([]provider.Bank, error) {
	return disbursement.FallbackBanks(), nil
}

func (r *recordingProvider) ResolveAccount(_ context.Context, bankCode, accountNumber string) (*provider.AccountResolution, error) {
	return &provider.AccountResolution{AccountName: "REC TEST", AccountNumber: accountNumber, BankCode: bankCode}, nil
}

func (r *recordingProvider) CreateTransferRecipient(_ context.Context, req provider.RecipientRequest) (*provider.Recipient, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.recipientReq = append(r.recipientReq, req)
	return &provider.Recipient{Code: r.name + "_rcp_test"}, nil
}

func (r *recordingProvider) InitiatePayout(_ context.Context, req provider.PayoutRequest) (*provider.PayoutResponse, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.payoutReq = append(r.payoutReq, req)
	ref := r.name + "_trf_test"
	return &provider.PayoutResponse{TransferCode: ref, Status: "pending", Reference: req.Reference, ProviderRef: ref}, nil
}

func (r *recordingProvider) GetTransferStatus(context.Context, string) (*provider.PayoutStatus, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.statusCalls++
	return r.transferStatus, r.transferStatusErr
}

func (r *recordingProvider) VerifyWebhookSignature([]byte, string) bool { return false }

func (r *recordingProvider) ParseWebhook([]byte) (*provider.WebhookEvent, error) {
	return nil, errors.New("recordingProvider: no webhooks")
}

func (r *recordingProvider) recipientCalls() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.recipientReq)
}

func (r *recordingProvider) payoutCalls() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.payoutReq)
}

func (r *recordingProvider) lastRecipient() provider.RecipientRequest {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.recipientReq[len(r.recipientReq)-1]
}

func recordingRegistry(rec *recordingProvider) *disbursement.Registry {
	return disbursement.NewRegistry(
		disbursement.Config{DefaultProvider: rec.name, FailoverEnabled: false},
		rec,
	)
}

// TestLiveDB_PayoutLegSendsFullAccountNumber is the CRITICAL regression: the
// provider leg used to receive account_number_last4 (4 digits) because the
// under-lock re-read overwrote the in-memory request value with a column that
// never held the full NUBAN. Asserts on BOTH the stored column and the exact
// RecipientRequest the provider saw.
func TestLiveDB_PayoutLegSendsFullAccountNumber(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	rec := &recordingProvider{name: "paystack"}
	svc := NewService(pool, led, tiers.NewService(pool), nil, recordingRegistry(rec))
	userID := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, userID, 10_000_000)
	if err := svc.pins.Set(ctx, userID, "1234"); err != nil {
		t.Fatalf("set pin: %v", err)
	}

	const fullAcct = "0123456789"
	bt, err := svc.InitiateBankTransfer(ctx, userID, BankTransferRequest{
		AccountNumber:  fullAcct,
		BankCode:       "044",
		AmountKobo:     1_000_000,
		PIN:            "1234",
		IdempotencyKey: "bt-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("InitiateBankTransfer: %v", err)
	}
	if rec.recipientCalls() == 0 {
		t.Fatal("provider never received a CreateTransferRecipient call")
	}
	got := rec.lastRecipient().AccountNumber
	if got != fullAcct {
		t.Fatalf("RecipientRequest.AccountNumber = %q, want full NUBAN %q (got last4?)", got, fullAcct)
	}

	// The row must persist the full number AND keep last4 for display.
	var storedAcct, storedLast4 string
	if err := pool.QueryRow(ctx,
		`SELECT account_number, account_number_last4 FROM bank_transfers WHERE id=$1`, bt.ID).
		Scan(&storedAcct, &storedLast4); err != nil {
		t.Fatalf("read stored account fields: %v", err)
	}
	if storedAcct != fullAcct {
		t.Fatalf("bank_transfers.account_number = %q, want %q", storedAcct, fullAcct)
	}
	if storedLast4 != "6789" {
		t.Fatalf("bank_transfers.account_number_last4 = %q, want 6789", storedLast4)
	}
}

// TestLiveDB_PayoutLegRefusesTerminalRow is the claim-window race: a reversal
// (or settle) that lands AFTER the caller's commit but BEFORE the leg claim is
// observed by the under-lock re-read; the non-terminal guard must refuse and
// the provider must never be called. Drives initiatePayoutLeg directly with a
// stale in-memory row — the exact interleaving the audit flagged at the
// InitiateBankTransfer and markFunded call sites.
func TestLiveDB_PayoutLegRefusesTerminalRow(t *testing.T) {
	for _, terminal := range []BankTransferStatus{BankTransferReversed, BankTransferFailed, BankTransferSuccessful} {
		t.Run(string(terminal), func(t *testing.T) {
			pool := liveDBPool(t)
			ctx := context.Background()
			led := newLiveLedgerService(pool)
			rec := &recordingProvider{name: "paystack"}
			svc := NewService(pool, led, tiers.NewService(pool), nil, recordingRegistry(rec))
			userID := seedUser(t, ctx, pool)

			bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferFundsReserved), string(SourceWallet), 500_000, 1_000)
			// Terminal outcome lands between reserve commit and leg claim.
			if _, err := pool.Exec(ctx, `UPDATE bank_transfers SET status=$1 WHERE id=$2`, string(terminal), bt.ID); err != nil {
				t.Fatalf("force terminal: %v", err)
			}
			// bt is stale in memory (funds_reserved) — the same snapshot the
			// auto-leg call sites hold when the race hits.
			if err := svc.initiatePayoutLeg(ctx, bt, false, "", "", requirePayoutableStatus); err == nil {
				t.Fatalf("payout leg on a %s row must be refused", terminal)
			}
			if rec.recipientCalls() != 0 || rec.payoutCalls() != 0 {
				t.Fatalf("provider fired on terminal row: %d recipient / %d payout calls", rec.recipientCalls(), rec.payoutCalls())
			}
		})
	}
}

// TestLiveDB_PayoutLegRefusesMissingAccountNumber is the pre-migration-row
// residual: a row with only last4 has nothing safe to send — the leg must hold
// (fail closed) rather than submit a 4-digit account number.
func TestLiveDB_PayoutLegRefusesMissingAccountNumber(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	rec := &recordingProvider{name: "paystack"}
	svc := NewService(pool, led, tiers.NewService(pool), nil, recordingRegistry(rec))
	userID := seedUser(t, ctx, pool)

	bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferFundsReserved), string(SourceWallet), 500_000, 1_000)
	if _, err := pool.Exec(ctx, `UPDATE bank_transfers SET account_number=NULL WHERE id=$1`, bt.ID); err != nil {
		t.Fatalf("null out account_number: %v", err)
	}
	if err := svc.initiatePayoutLeg(ctx, bt, false, "", "", requirePayoutableStatus); err == nil {
		t.Fatal("payout leg on a row with no full account number must refuse")
	}
	if rec.recipientCalls() != 0 || rec.payoutCalls() != 0 {
		t.Fatalf("provider fired without a full account number: %d/%d calls", rec.recipientCalls(), rec.payoutCalls())
	}
	// The row must still be in its hold state — funds stay parked, never lost.
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM bank_transfers WHERE id=$1`, bt.ID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != string(BankTransferFundsReserved) {
		t.Fatalf("status = %s, want funds_reserved (held for reconciliation)", status)
	}
}

// TestLiveDB_SettleForeignLegKeyRefused exercises the ON CONFLICT absorb fix:
// a ledger entry claiming the settle leg's idempotency key with a DIFFERENT
// shape (account/amount/type/reference) must abort the settle, not be silently
// skipped — otherwise a foreign or pre-existing row shadows the real leg and
// the journal silently loses a side.
func TestLiveDB_SettleForeignLegKeyRefused(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, nil)
	userID := seedUser(t, ctx, pool)

	bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferProviderInitiated), string(SourceWallet), 750_000, 1_000)

	// Attacker/foreign pre-claim: same key, wrong amount on a real account.
	otherAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("other account: %v", err)
	}
	foreignKey := LegKey(bt.IdempotencyKey, LegSettle) + ":debit"
	if _, err := pool.Exec(ctx,
		`INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		 VALUES ($1,'DEBIT',1,$2,$3)`, otherAcc.ID, bt.Reference, foreignKey); err != nil {
		t.Fatalf("insert foreign leg: %v", err)
	}

	if err := svc.settleTransfer(ctx, bt, BankTransferSuccessful); err == nil {
		t.Fatal("settleTransfer must fail closed when a foreign row claims a leg key")
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM bank_transfers WHERE id=$1`, bt.ID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != string(BankTransferProviderInitiated) {
		t.Fatalf("status = %s, want provider_initiated — aborted settle must not flip it", status)
	}
}

// TestLiveDB_SettleIdenticalLegKeyIsReplay is the other half of the fix: a key
// already held by the IDENTICAL leg is a true replay and must still no-op.
func TestLiveDB_SettleIdenticalLegKeyIsReplay(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, nil)
	userID := seedUser(t, ctx, pool)

	bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferProviderInitiated), string(SourceWallet), 750_000, 1_000)
	suspense, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountFailedTransferSusp)
	if err != nil {
		t.Fatalf("suspense acct: %v", err)
	}
	// Pre-insert the exact debit leg the settle is about to post.
	if _, err := pool.Exec(ctx,
		`INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		 VALUES ($1,'DEBIT',$2,$3,$4)`, suspense.ID, bt.AmountKobo, bt.Reference, LegKey(bt.IdempotencyKey, LegSettle)+":debit"); err != nil {
		t.Fatalf("insert identical leg: %v", err)
	}

	if err := svc.settleTransfer(ctx, bt, BankTransferSuccessful); err != nil {
		t.Fatalf("identical-key replay must be a no-op, got %v", err)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM bank_transfers WHERE id=$1`, bt.ID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != string(BankTransferSuccessful) {
		t.Fatalf("status = %s, want successful", status)
	}
}

// TestLiveDB_JournalLegTxForeignVsReplay drives the tx-scoped helper directly:
// a conflicting DIFFERENT leg under the key errors (tx aborts), while the
// identical leg is a replay no-op.
func TestLiveDB_JournalLegTxForeignVsReplay(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	suspense, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountFailedTransferSusp)
	if err != nil {
		t.Fatalf("suspense acct: %v", err)
	}
	settleAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("settlement acct: %v", err)
	}
	revenue, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("revenue acct: %v", err)
	}
	base := "jt-" + uuid.New().String()

	// Replay: post the journal, then post it again inside a second tx — the
	// second pass must verify-identical rather than error.
	tx1, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := insertJournalLegTx(ctx, tx1, "ref-jt", base, 1000, suspense.ID, settleAcc.ID); err != nil {
		t.Fatalf("first journal: %v", err)
	}
	if err := tx1.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	tx2, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin2: %v", err)
	}
	if err := insertJournalLegTx(ctx, tx2, "ref-jt", base, 1000, suspense.ID, settleAcc.ID); err != nil {
		_ = tx2.Rollback(ctx)
		t.Fatalf("identical replay must be a no-op, got %v", err)
	}
	if err := tx2.Commit(ctx); err != nil {
		t.Fatalf("commit2: %v", err)
	}

	// Foreign: same key prefix, different credit account → must error.
	tx3, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin3: %v", err)
	}
	err = insertJournalLegTx(ctx, tx3, "ref-jt", base, 1000, suspense.ID, revenue.ID)
	_ = tx3.Rollback(ctx)
	if err == nil {
		t.Fatal("foreign leg under an existing key must fail closed")
	}
}

// TestLiveDB_AdminRetryProviderInitiatedReconciles is the MED-3 fix: a retry on
// provider_initiated never blindly re-fires the payout. The provider is queried
// by provider_transfer_ref first — a confirmed failure settles the refund;
// anything else refuses to re-fire.
func TestLiveDB_AdminRetryProviderInitiatedReconciles(t *testing.T) {
	seedInitiated := func(t *testing.T, svc *Service, pool *pgxpool.Pool, ctx context.Context, userID string) *BankTransfer {
		t.Helper()
		bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferProviderInitiated), string(SourceWallet), 500_000, 1_000)
		ref := "paystack_trf_test"
		if _, err := pool.Exec(ctx, `UPDATE bank_transfers SET provider_transfer_ref=$1, provider_transfer_code=$1 WHERE id=$2`, ref, bt.ID); err != nil {
			t.Fatalf("set provider ref: %v", err)
		}
		fresh, err := svc.getBankTransfer(ctx, bt.ID)
		if err != nil {
			t.Fatalf("re-read: %v", err)
		}
		return fresh
	}

	t.Run("provider says failed → settle refund, no re-fire", func(t *testing.T) {
		pool := liveDBPool(t)
		ctx := context.Background()
		led := newLiveLedgerService(pool)
		rec := &recordingProvider{name: "paystack", transferStatus: &provider.PayoutStatus{Status: "failed"}}
		svc := NewService(pool, led, tiers.NewService(pool), nil, recordingRegistry(rec))
		userID := seedUser(t, ctx, pool)
		bt := seedInitiated(t, svc, pool, ctx, userID)

		got, err := svc.AdminRetry(ctx, bt.ID, userID)
		if err != nil {
			t.Fatalf("AdminRetry on confirmed-failed payout: %v", err)
		}
		if got.Status != BankTransferFailed {
			t.Fatalf("status = %s, want failed (provider-confirmed failure settled)", got.Status)
		}
		if rec.payoutCalls() != 0 || rec.recipientCalls() != 0 {
			t.Fatalf("re-fired the provider on a confirmed outcome: %d/%d calls", rec.recipientCalls(), rec.payoutCalls())
		}
		if rec.statusCalls == 0 {
			t.Fatal("provider status was never queried before the retry decision")
		}
	})

	t.Run("provider says successful/pending → refuse to re-fire", func(t *testing.T) {
		for _, st := range []string{"successful", "pending"} {
			pool := liveDBPool(t)
			ctx := context.Background()
			led := newLiveLedgerService(pool)
			rec := &recordingProvider{name: "paystack", transferStatus: &provider.PayoutStatus{Status: st}}
			svc := NewService(pool, led, tiers.NewService(pool), nil, recordingRegistry(rec))
			userID := seedUser(t, ctx, pool)
			bt := seedInitiated(t, svc, pool, ctx, userID)

			_, err := svc.AdminRetry(ctx, bt.ID, userID)
			if !errors.Is(err, ErrPayoutAlreadyFired) {
				t.Fatalf("provider status %q → AdminRetry = %v, want ErrPayoutAlreadyFired", st, err)
			}
			if rec.payoutCalls() != 0 || rec.recipientCalls() != 0 {
				t.Fatalf("provider status %q: re-fired provider (%d/%d calls)", st, rec.recipientCalls(), rec.payoutCalls())
			}
		}
	})

	t.Run("provider unreachable → fail closed, no re-fire", func(t *testing.T) {
		pool := liveDBPool(t)
		ctx := context.Background()
		led := newLiveLedgerService(pool)
		rec := &recordingProvider{name: "paystack", transferStatusErr: errors.New("provider timeout")}
		svc := NewService(pool, led, tiers.NewService(pool), nil, recordingRegistry(rec))
		userID := seedUser(t, ctx, pool)
		bt := seedInitiated(t, svc, pool, ctx, userID)

		if _, err := svc.AdminRetry(ctx, bt.ID, userID); err == nil {
			t.Fatal("unverifiable fired payout must fail closed, not re-fire")
		}
		if rec.payoutCalls() != 0 || rec.recipientCalls() != 0 {
			t.Fatalf("re-fired an unverified payout: %d/%d calls", rec.recipientCalls(), rec.payoutCalls())
		}
	})

	t.Run("missing provider_transfer_ref → fail closed", func(t *testing.T) {
		pool := liveDBPool(t)
		ctx := context.Background()
		led := newLiveLedgerService(pool)
		rec := &recordingProvider{name: "paystack"}
		svc := NewService(pool, led, tiers.NewService(pool), nil, recordingRegistry(rec))
		userID := seedUser(t, ctx, pool)
		// provider_initiated but no ref to verify against — the worst wedge.
		bt := seedBankTransfer(t, ctx, pool, svc, userID, string(BankTransferProviderInitiated), string(SourceWallet), 500_000, 1_000)

		if _, err := svc.AdminRetry(ctx, bt.ID, userID); err == nil {
			t.Fatal("provider_initiated without a ref must fail closed")
		}
		if rec.payoutCalls() != 0 || rec.recipientCalls() != 0 {
			t.Fatalf("re-fired an unverifiable payout: %d/%d calls", rec.recipientCalls(), rec.payoutCalls())
		}
	})
}
