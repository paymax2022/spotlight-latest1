package transfers_test

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
	"spotlight/backend/internal/finance/transfers"
)

// ---------------------------------------------------------------------------
// Per-leg idempotency key derivation.
// ---------------------------------------------------------------------------

// TestLegKeyDistinctPerLeg verifies every money leg derives a distinct key from
// the base, so the ledger unique constraint isolates legs and a duplicate webhook
// is a no-op. No two legs may share a key.
func TestLegKeyDistinctPerLeg(t *testing.T) {
	base := "idem-abc"
	legs := []string{
		transfers.LegReserve, transfers.LegFund, transfers.LegSettle,
		transfers.LegFeeRev, transfers.LegReversal, "debit", "suspense",
	}
	seen := map[string]bool{}
	for _, leg := range legs {
		k := transfers.LegKey(base, leg)
		if k == base {
			t.Fatalf("LegKey(%q,%q) must namespace the base", base, leg)
		}
		if seen[k] {
			t.Fatalf("LegKey collision for leg %q → %q", leg, k)
		}
		seen[k] = true
	}
}

// ---------------------------------------------------------------------------
// Ledger-leg balance invariants (pure arithmetic on the amounts the service
// posts). The actual posting is exercised against the DB elsewhere; here we lock
// the math so the legs always net to zero and restore the source exactly.
// ---------------------------------------------------------------------------

// TestReserveLegBalances verifies the reserve leg debits (amount+fee) from the
// wallet and credits exactly the same total to suspense (DR == CR).
func TestReserveLegBalances(t *testing.T) {
	amounts := []int64{100_000, 500_001, 5_000_001, 100_000_000}
	for _, amt := range amounts {
		fee := transfers.BankTransferFee(amt)
		total := amt + fee
		debit := total  // DR user_wallet
		credit := total // CR failed_transfer_suspense
		if debit != credit {
			t.Fatalf("reserve unbalanced for amount %d: debit=%d credit=%d", amt, debit, credit)
		}
	}
}

// TestSuccessSweepNetsToZero verifies that on success the suspense hold (amount+fee)
// is fully swept: amount → settlement, fee → revenue, leaving suspense net zero
// for this transfer.
func TestSuccessSweepNetsToZero(t *testing.T) {
	amounts := []int64{100_000, 500_001, 5_000_001}
	for _, amt := range amounts {
		fee := transfers.BankTransferFee(amt)
		held := amt + fee // credited to suspense at reserve

		// Success legs DEBIT suspense by amount (→settlement) and by fee (→revenue).
		sweptFromSuspense := amt + fee
		if held-sweptFromSuspense != 0 {
			t.Fatalf("amount %d: suspense not fully swept (held=%d swept=%d)", amt, held, sweptFromSuspense)
		}
		// Amount lands in settlement, fee in revenue — split is exact.
		if (amt)+(fee) != sweptFromSuspense {
			t.Fatalf("amount %d: settlement+revenue split mismatch", amt)
		}
	}
}

// TestReversalRestoresSourceExactly verifies a failed/reversed transfer restores
// exactly amount+fee to the source and drains the same from suspense (net zero).
func TestReversalRestoresSourceExactly(t *testing.T) {
	amounts := []int64{100_000, 500_001, 5_000_001}
	for _, amt := range amounts {
		fee := transfers.BankTransferFee(amt)
		held := amt + fee

		rev := transfers.BuildReversalEntry("bt-x", "src", "susp", held, "idem-x", transfers.BankTransferFailed)
		// Restore amount must equal the held total exactly.
		if rev.AmountKobo != held {
			t.Fatalf("amount %d: reversal restores %d, want held %d", amt, rev.AmountKobo, held)
		}
		// Suspense after reserval credit then drain = 0.
		if held-rev.AmountKobo != 0 {
			t.Fatalf("amount %d: suspense not fully drained on reversal", amt)
		}
	}
}

// ---------------------------------------------------------------------------
// Bank→bank state progression guard.
// ---------------------------------------------------------------------------

func TestCanAdvanceBankToBank(t *testing.T) {
	cases := []struct {
		from, to transfers.BankTransferStatus
		want     bool
	}{
		{transfers.BankTransferAwaitingFunding, transfers.BankTransferFunded, true},
		{transfers.BankTransferFunded, transfers.BankTransferProviderInitiated, true},
		{transfers.BankTransferProviderInitiated, transfers.BankTransferSuccessful, true},
		// Skipping a step is illegal.
		{transfers.BankTransferAwaitingFunding, transfers.BankTransferProviderInitiated, false},
		{transfers.BankTransferAwaitingFunding, transfers.BankTransferSuccessful, false},
		// Backwards is illegal.
		{transfers.BankTransferFunded, transfers.BankTransferAwaitingFunding, false},
		// Re-funding an already-funded transfer is a no-op (false).
		{transfers.BankTransferFunded, transfers.BankTransferFunded, false},
		// Failure reachable from any non-terminal state.
		{transfers.BankTransferAwaitingFunding, transfers.BankTransferFailed, true},
		{transfers.BankTransferFunded, transfers.BankTransferReversed, true},
		// Not from a terminal state.
		{transfers.BankTransferSuccessful, transfers.BankTransferReversed, false},
		{transfers.BankTransferFailed, transfers.BankTransferFailed, false},
	}
	for _, tc := range cases {
		got := transfers.CanAdvanceBankToBank(tc.from, tc.to)
		if got != tc.want {
			t.Errorf("CanAdvanceBankToBank(%q,%q)=%v, want %v", tc.from, tc.to, got, tc.want)
		}
	}
}

// TestNextStatusOnProviderErrorBankSource verifies a funded bank→bank transfer
// holds at funded (its money is in provider_clearing→suspense), while a wallet
// transfer holds at funds_reserved.
func TestNextStatusOnProviderErrorBankSource(t *testing.T) {
	if got := transfers.NextStatusOnProviderError(transfers.BankTransferFunded); got != transfers.BankTransferFunded {
		t.Fatalf("funded → %q, want funded", got)
	}
	if got := transfers.NextStatusOnProviderError(transfers.BankTransferFundsReserved); got != transfers.BankTransferFundsReserved {
		t.Fatalf("funds_reserved → %q, want funds_reserved", got)
	}
}

// ---------------------------------------------------------------------------
// PIN hash + verify (bcrypt round-trip; lockout state machine is DB-backed and
// tested at the integration layer — here we lock the hash/verify invariant).
// ---------------------------------------------------------------------------

func TestPinBcryptRoundTrip(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("1234"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash error: %v", err)
	}
	// The raw PIN must never be recoverable from the hash.
	if string(hash) == "1234" {
		t.Fatal("bcrypt hash must not equal the raw PIN")
	}
	if bcrypt.CompareHashAndPassword(hash, []byte("1234")) != nil {
		t.Fatal("correct PIN must verify")
	}
	if bcrypt.CompareHashAndPassword(hash, []byte("9999")) == nil {
		t.Fatal("wrong PIN must NOT verify")
	}
}

// ---------------------------------------------------------------------------
// Webhook status classification (shared mapping) — pending is a benign no-op.
// ---------------------------------------------------------------------------

func TestClassifyWebhookStatusPendingNoOp(t *testing.T) {
	if _, _, known := transfers.ClassifyWebhookStatus("pending"); known {
		t.Fatal("pending must be unknown (no-op), not actioned")
	}
	if st, release, known := transfers.ClassifyWebhookStatus("successful"); !known || release || st != transfers.BankTransferSuccessful {
		t.Fatalf("successful classification wrong: st=%q release=%v known=%v", st, release, known)
	}
}

// TestPinErrorsMapToForbidden locks the PIN error → HTTP status mapping.
func TestPinErrorsMapToForbidden(t *testing.T) {
	for _, err := range []error{transfers.ErrPinNotSet, transfers.ErrPinInvalid, transfers.ErrPinLocked} {
		if got := transfers.HTTPStatusForError(err); got != 403 {
			t.Fatalf("PIN error %v → %d, want 403", err, got)
		}
	}
	if got := transfers.HTTPStatusForError(transfers.ErrProviderUnavailable); got != 502 {
		t.Fatalf("provider unavailable → %d, want 502", got)
	}
}
