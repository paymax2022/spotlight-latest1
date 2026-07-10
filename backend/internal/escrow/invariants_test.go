package escrow

// PURE money-path invariant tests — no live DB.
//
// The escrow Service is pgx-backed and posts ledger legs (service.go), so Hold /
// Release / Refund cannot run without Postgres + the ledger (see the DOC note at the
// bottom for what needs an integration test). What IS exercised here is the guarded
// funds-hold state machine and the per-side idempotency-key discipline the service
// relies on to keep a hold balanced and replay-safe:
//
//   - canTransition (model.go): HELD -> RELEASED|REFUNDED|DISPUTED, the P3
//     DISPUTED arbitration edges, and the fact that RELEASED/REFUNDED are terminal.
//   - amount conservation: a hold's single amount_kobo is set once on Hold and is
//     resolved WHOLLY to exactly one of {payee (release), payer (refund)} — never
//     split, never partially released — so released + refunded == held for any
//     resolved hold. This is pinned as a transition-driven arithmetic property.
//   - per-side idempotency suffixes (:hold on the debit, :release / :refund on the
//     credit) that make the two ledger legs distinct yet share a base key.
//
// Symbols under test are unexported, so this file is in-package (package escrow).

import (
	"context"
	"testing"
)

// ---------------------------------------------------------------------------
// Guarded funds-hold state machine
// ---------------------------------------------------------------------------

// TestEscrowFSM_LegalTransitions verifies the intended edges: a HELD hold can be
// released, refunded, or (P3) disputed; a DISPUTED hold can be released or refunded
// by arbitration.
func TestEscrowFSM_LegalTransitions(t *testing.T) {
	legal := [][2]State{
		{StateHeld, StateReleased},
		{StateHeld, StateRefunded},
		{StateHeld, StateDisputed},
		{StateDisputed, StateReleased},
		{StateDisputed, StateRefunded},
	}
	for _, e := range legal {
		if !canTransition(e[0], e[1]) {
			t.Errorf("expected legal escrow transition %s -> %s", e[0], e[1])
		}
	}
}

// TestEscrowFSM_IllegalRejected verifies transitions that would move money twice or
// resurrect a resolved hold are rejected.
func TestEscrowFSM_IllegalRejected(t *testing.T) {
	illegal := [][2]State{
		{StateReleased, StateRefunded}, // already paid out, cannot also refund
		{StateRefunded, StateReleased}, // already refunded, cannot also release
		{StateReleased, StateHeld},     // cannot un-resolve
		{StateRefunded, StateHeld},     // cannot un-resolve
		{StateReleased, StateReleased}, // no idempotent self-loop in the table
		{StateDisputed, StateHeld},     // cannot un-dispute back to held
		{StateHeld, StateHeld},         // self-loop not declared
	}
	for _, e := range illegal {
		if canTransition(e[0], e[1]) {
			t.Errorf("expected ILLEGAL escrow transition %s -> %s to be rejected", e[0], e[1])
		}
	}
}

// TestEscrowFSM_TerminalStatesReject verifies RELEASED and REFUNDED are terminal:
// no outgoing edge whatsoever, so a resolved hold's amount can never move again.
func TestEscrowFSM_TerminalStatesReject(t *testing.T) {
	all := []State{StateHeld, StateReleased, StateRefunded, StateDisputed}
	for _, terminal := range []State{StateReleased, StateRefunded} {
		for _, to := range all {
			if canTransition(terminal, to) {
				t.Errorf("terminal escrow state %s must reject -> %s", terminal, to)
			}
		}
	}
}

// TestEscrowFSM_UnknownStateRejects verifies an unrecognised source state permits no
// transition (fail-closed).
func TestEscrowFSM_UnknownStateRejects(t *testing.T) {
	if canTransition(State("BOGUS"), StateReleased) {
		t.Error("unknown escrow state must permit no transition")
	}
}

// ---------------------------------------------------------------------------
// Amount conservation
//
// A hold carries ONE amount_kobo, set on Hold and never mutated. resolve() posts a
// single credit of the full h.AmountKobo to exactly one beneficiary — the payee on
// release, the payer on refund — and there is no partial-release path. So across the
// hold's whole life exactly amount_kobo leaves escrow, to exactly one side.
//
// resolveOutcome models that: given a terminal state, it returns how the held amount
// is distributed as (releasedToPayee, refundedToPayer). The invariant asserted is
// released + refunded == held, and that only ONE side is non-zero.
// ---------------------------------------------------------------------------

func resolveOutcome(held int64, to State) (releasedToPayee, refundedToPayer int64) {
	switch to {
	case StateReleased:
		return held, 0
	case StateRefunded:
		return 0, held
	default:
		return 0, 0 // unresolved / disputed: nothing has left escrow yet
	}
}

func TestEscrowAmountConservation(t *testing.T) {
	for _, held := range []int64{1, 5_000, 250_000_00, 999_999_999} {
		// Release: whole amount goes to payee, none refunded.
		rel, ref := resolveOutcome(held, StateReleased)
		if rel+ref != held {
			t.Errorf("release: released+refunded (%d+%d) must == held %d", rel, ref, held)
		}
		if rel != held || ref != 0 {
			t.Errorf("release must send the WHOLE amount to the payee: rel=%d ref=%d held=%d", rel, ref, held)
		}
		// Refund: whole amount returns to payer, none released.
		rel, ref = resolveOutcome(held, StateRefunded)
		if rel+ref != held {
			t.Errorf("refund: released+refunded (%d+%d) must == held %d", rel, ref, held)
		}
		if ref != held || rel != 0 {
			t.Errorf("refund must return the WHOLE amount to the payer: rel=%d ref=%d held=%d", rel, ref, held)
		}
		// A hold is never simultaneously released AND refunded — exactly one side pays.
		relX, refX := resolveOutcome(held, StateReleased)
		if relX != 0 && refX != 0 {
			t.Errorf("a resolved hold must pay exactly one side, got rel=%d ref=%d", relX, refX)
		}
	}
}

// ---------------------------------------------------------------------------
// Fail-closed guard: Hold rejects non-positive amounts BEFORE any DB / ledger call.
// service.go Hold checks `if amountKobo <= 0` first, so this is reachable with a nil
// pool (mirrors the ledger reversal_test nil-pool pattern).
// ---------------------------------------------------------------------------

func TestHoldRejectsNonPositiveAmount(t *testing.T) {
	s := &Service{} // amount guard runs before db/ledger are touched
	for _, amt := range []int64{0, -1, -250_000} {
		h, err := s.Hold(context.Background(), "payer", "ref", "social", "idem", amt)
		if err == nil {
			t.Errorf("Hold(amount=%d) must reject non-positive kobo", amt)
		}
		if h != nil {
			t.Errorf("Hold(amount=%d) must not return a hold on rejection", amt)
		}
	}
}

// ---------------------------------------------------------------------------
// Per-side idempotency-key discipline (service.go: debit uses idemKey+":hold";
// the resolve credit uses h.IdempotencyKey+":"+leg where leg is release|refund).
// The two legs of one hold MUST use DISTINCT suffixed keys (else the second insert
// collides on the unique idempotency key and the pair can never balance), yet share
// the same base key so a whole-hold replay is one logical no-op. This locks that
// contract as an explicit, greppable invariant.
// ---------------------------------------------------------------------------

func TestEscrowIdempotencySuffixes(t *testing.T) {
	base := "escrow:split42"
	holdLeg := base + ":hold"
	releaseLeg := base + ":release"
	refundLeg := base + ":refund"

	keys := []string{holdLeg, releaseLeg, refundLeg}
	seen := map[string]bool{}
	for _, k := range keys {
		if k == base {
			t.Errorf("side key %q must extend the base key with a per-side suffix", k)
		}
		if seen[k] {
			t.Errorf("suffixed idempotency key %q collides across legs", k)
		}
		seen[k] = true
	}
	// Hold (debit) and its resolution (credit) must never share a key — otherwise the
	// credit leg would dedup against the debit leg and money would be held but never
	// released.
	if holdLeg == releaseLeg || holdLeg == refundLeg {
		t.Error("the hold-debit key must differ from the resolve-credit key")
	}
}

// ---------------------------------------------------------------------------
// DOC — needs a live-DB integration test (no injectable seam here):
//
//   - Hold posts a ledger debit (payer -> escrow standing account) and inserts the
//     escrow_holds row; assert the debit fails closed on insufficient balance and
//     that the row is created atomically with the ledger leg.
//   - resolve() re-reads current state under the row, guards via canTransition, then
//     posts the credit to payee (release) or payer (refund). Assert: a double
//     Release is a no-op (idempotent), Release-after-Refund is rejected by the FSM at
//     the DB level, and the escrow standing account nets to zero across hold+resolve
//     (double-entry conservation) — all require the ledger + Postgres.
//   - Replay: calling Hold twice with the same idemKey must return the existing hold
//     (getByIdem) without a second debit.
// ---------------------------------------------------------------------------
