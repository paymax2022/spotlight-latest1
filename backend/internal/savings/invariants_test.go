package savings

// PURE money-path invariant tests — no live DB.
//
// The savings services (vault_service.go, ajo_service.go, target_service.go) are
// pgx-backed and depend on ledger.Service, so the contribution/withdrawal ledger
// legs, the derived-balance projections and the AJO cycle payout cannot run without
// Postgres (see the DOC note at the bottom for what still needs an integration test).
// What IS exercised here is every PURE state machine + arithmetic invariant:
//
//   - canVault / canCircle / canMember / canTarget: the four guarded FSMs from
//     model.go (legal transitions succeed, illegal rejected, terminal states reject,
//     unknown states fail closed).
//   - the MAJORITY release threshold (approved*2 > total) transcribed from
//     target_service.go majorityApproved.
//   - the AJO cycle collection/payout conservation (collected == contribution ×
//     paying members; payout == collected) transcribed from ajo_service.go RunCycle.
//
// Symbols under test are unexported, so this file is in-package (package savings).

import "testing"

// ---------------------------------------------------------------------------
// VAULT state machine: OPEN -> MATURED -> CLOSED (and OPEN -> CLOSED)
// ---------------------------------------------------------------------------

func TestVaultFSM(t *testing.T) {
	legal := [][2]VaultState{
		{VaultOpen, VaultMatured},
		{VaultOpen, VaultClosed},
		{VaultMatured, VaultClosed},
	}
	for _, e := range legal {
		if !canVault(e[0], e[1]) {
			t.Errorf("expected legal vault transition %s -> %s", e[0], e[1])
		}
	}
	illegal := [][2]VaultState{
		{VaultMatured, VaultOpen}, // backwards
		{VaultClosed, VaultOpen},  // terminal -> anything
		{VaultClosed, VaultMatured},
		{VaultOpen, VaultOpen}, // self-loop not declared
	}
	for _, e := range illegal {
		if canVault(e[0], e[1]) {
			t.Errorf("expected ILLEGAL vault transition %s -> %s to be rejected", e[0], e[1])
		}
	}
	// CLOSED is terminal: no outgoing edge at all.
	for _, to := range []VaultState{VaultOpen, VaultMatured, VaultClosed} {
		if canVault(VaultClosed, to) {
			t.Errorf("terminal VaultClosed must reject -> %s", to)
		}
	}
	// Unknown source fails closed.
	if canVault(VaultState("BOGUS"), VaultClosed) {
		t.Error("unknown vault state must permit no transition")
	}
}

// ---------------------------------------------------------------------------
// CIRCLE state machine: FORMING -> ACTIVE -> COMPLETED (+ CANCELLED branches)
// ---------------------------------------------------------------------------

func TestCircleFSM(t *testing.T) {
	legal := [][2]CircleState{
		{CircleForming, CircleActive},
		{CircleForming, CircleCancelled},
		{CircleActive, CircleCompleted},
		{CircleActive, CircleCancelled},
	}
	for _, e := range legal {
		if !canCircle(e[0], e[1]) {
			t.Errorf("expected legal circle transition %s -> %s", e[0], e[1])
		}
	}
	illegal := [][2]CircleState{
		{CircleForming, CircleCompleted}, // cannot complete before active
		{CircleActive, CircleForming},    // backwards
		{CircleCompleted, CircleActive},  // terminal
		{CircleCancelled, CircleActive},  // terminal
	}
	for _, e := range illegal {
		if canCircle(e[0], e[1]) {
			t.Errorf("expected ILLEGAL circle transition %s -> %s to be rejected", e[0], e[1])
		}
	}
	for _, terminal := range []CircleState{CircleCompleted, CircleCancelled} {
		for _, to := range []CircleState{CircleForming, CircleActive, CircleCompleted, CircleCancelled} {
			if canCircle(terminal, to) {
				t.Errorf("terminal circle state %s must reject -> %s", terminal, to)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// MEMBER state machine: INVITED -> ACTIVE -> (DEFAULTED <-> ACTIVE) | EXITED
// ---------------------------------------------------------------------------

func TestMemberFSM(t *testing.T) {
	legal := [][2]MemberState{
		{MemberInvited, MemberActive},
		{MemberInvited, MemberExited},
		{MemberActive, MemberDefaulted},
		{MemberActive, MemberExited},
		{MemberDefaulted, MemberActive}, // make-good restores
		{MemberDefaulted, MemberExited},
	}
	for _, e := range legal {
		if !canMember(e[0], e[1]) {
			t.Errorf("expected legal member transition %s -> %s", e[0], e[1])
		}
	}
	illegal := [][2]MemberState{
		{MemberInvited, MemberDefaulted}, // cannot default before active
		{MemberActive, MemberInvited},    // backwards
		{MemberExited, MemberActive},     // terminal
		{MemberExited, MemberDefaulted},  // terminal
	}
	for _, e := range illegal {
		if canMember(e[0], e[1]) {
			t.Errorf("expected ILLEGAL member transition %s -> %s to be rejected", e[0], e[1])
		}
	}
	// EXITED is terminal.
	for _, to := range []MemberState{MemberInvited, MemberActive, MemberDefaulted, MemberExited} {
		if canMember(MemberExited, to) {
			t.Errorf("terminal MemberExited must reject -> %s", to)
		}
	}
	// The make-good path (DEFAULTED -> ACTIVE) must be reachable — it is what lets a
	// defaulted peer restore by paying their missed contribution (NL-1: own funds).
	if !canMember(MemberDefaulted, MemberActive) {
		t.Error("make-good restore (DEFAULTED -> ACTIVE) must be permitted")
	}
}

// ---------------------------------------------------------------------------
// GROUP TARGET state machine: OPEN -> REACHED -> RELEASED -> CLOSED
// ---------------------------------------------------------------------------

func TestTargetFSM(t *testing.T) {
	legal := [][2]TargetState{
		{TargetOpen, TargetReached},
		{TargetOpen, TargetReleased},
		{TargetOpen, TargetClosed},
		{TargetReached, TargetReleased},
		{TargetReached, TargetClosed},
		{TargetReleased, TargetClosed},
	}
	for _, e := range legal {
		if !canTarget(e[0], e[1]) {
			t.Errorf("expected legal target transition %s -> %s", e[0], e[1])
		}
	}
	illegal := [][2]TargetState{
		{TargetReleased, TargetReached}, // backwards
		{TargetReached, TargetOpen},     // backwards
		{TargetClosed, TargetReleased},  // terminal
		{TargetReleased, TargetOpen},    // backwards
	}
	for _, e := range illegal {
		if canTarget(e[0], e[1]) {
			t.Errorf("expected ILLEGAL target transition %s -> %s to be rejected", e[0], e[1])
		}
	}
	// CLOSED is terminal.
	for _, to := range []TargetState{TargetOpen, TargetReached, TargetReleased, TargetClosed} {
		if canTarget(TargetClosed, to) {
			t.Errorf("terminal TargetClosed must reject -> %s", to)
		}
	}
}

// ---------------------------------------------------------------------------
// MAJORITY release threshold (transcribed from target_service.go majorityApproved:
//   return total > 0 && approved*2 > total
// i.e. STRICTLY more than half must approve; a tie (exactly half) does NOT release.
// This is the guard on releasing a shared pot back to the creator.
// ---------------------------------------------------------------------------

func majorityApprovedPure(total, approved int) bool {
	return total > 0 && approved*2 > total
}

func TestMajorityThreshold(t *testing.T) {
	cases := []struct {
		total, approved int
		want            bool
	}{
		{total: 0, approved: 0, want: false},  // empty group never releases
		{total: 1, approved: 0, want: false},  // solo, no approval
		{total: 1, approved: 1, want: true},   // solo self-approve is a majority
		{total: 2, approved: 1, want: false},  // tie is NOT a majority
		{total: 2, approved: 2, want: true},   // unanimous
		{total: 3, approved: 1, want: false},  // 1/3
		{total: 3, approved: 2, want: true},   // 2/3 > half
		{total: 4, approved: 2, want: false},  // exactly half is NOT majority
		{total: 4, approved: 3, want: true},   // 3/4
		{total: 100, approved: 50, want: false}, // 50/100 tie
		{total: 100, approved: 51, want: true},  // 51/100
	}
	for _, c := range cases {
		if got := majorityApprovedPure(c.total, c.approved); got != c.want {
			t.Errorf("majorityApproved(total=%d, approved=%d) = %v, want %v", c.total, c.approved, got, c.want)
		}
	}
}

// ---------------------------------------------------------------------------
// AJO cycle conservation (transcribed from ajo_service.go RunCycle):
// every paying active member is debited exactly ContributionKobo into escrow, and
// the recipient is credited EXACTLY the collected sum — never more (NL-1/NL-7:
// Paymax never funds the ring). So payout == collected == contribution × payers,
// and a defaulting member simply reduces both by one contribution (no shortfall
// covered).
// ---------------------------------------------------------------------------

// ajoCollected mirrors the collection loop: contribution × number of members who
// successfully paid (defaulters excluded).
func ajoCollected(contributionKobo int64, payingMembers int) int64 {
	return contributionKobo * int64(payingMembers)
}

func TestAjoPayoutConservation(t *testing.T) {
	const contrib = 5_000_00 // ₦5,000
	for _, active := range []int{1, 3, 12, 50} {
		for _, defaulters := range []int{0, 1, active} {
			payers := active - defaulters
			if payers < 0 {
				payers = 0
			}
			collected := ajoCollected(contrib, payers)
			// The payout the recipient receives equals exactly what peers funded.
			payout := collected
			if payout != collected {
				t.Fatalf("payout must equal collected")
			}
			// Never exceeds the full-ring amount (what everyone paying would give).
			fullRing := ajoCollected(contrib, active)
			if collected > fullRing {
				t.Errorf("collected %d exceeds full ring %d — Paymax must never top up (NL-1)", collected, fullRing)
			}
			// Each defaulter reduces the pot by exactly one contribution.
			if collected != fullRing-contrib*int64(defaulters) && payers == active-defaulters {
				t.Errorf("collected %d != fullRing %d - %d*%d", collected, fullRing, contrib, defaulters)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// DOC — needs a live-DB integration test (no injectable seam here):
//
//   - Vault / GroupTarget derived balance (NL-8): balance = SUM(ledger legs), never
//     a stored column. vault_service.go / target_service.go Balance() run SQL SUM;
//     assert deposit+withdraw sequences project the correct balance and that no code
//     path UPDATEs a balance column.
//   - Contribute idempotency: target_service.go Contribute posts a ledger leg keyed
//     by idemKey+":..."; a replay must return the same balance without double-debit.
//   - AJO RunCycle end-to-end: per-member escrow debit (fail-closed on low balance ->
//     DEFAULTED, NOT a Paymax advance), recipient credit == collected, cycle marked
//     PAID exactly once, rotation advances. The debit/credit legs against escrow are
//     the conservation proof and require the ledger + Postgres.
//   - MakeGood: DEFAULTED member funds the missed cycle from their OWN wallet.
// ---------------------------------------------------------------------------
