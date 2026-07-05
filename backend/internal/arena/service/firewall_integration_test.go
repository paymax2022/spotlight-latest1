package service

import (
	"context"
	"testing"

	"spotlight/backend/internal/arena"
)

// TestFirewall_EndToEnd_SupportMovesPotNotMerit is the headline NDC-1 integrity
// check: it exercises the full merit path (submit a signed theory score → verify →
// append → batch-cutoff to QUALIFIED) and then proves that a large Support
// contribution moves the prize pot and the People's Champion tally WITHOUT moving
// any merit / leaderboard / crown value. Money can never buy merit.
//
// Scenario:
//   - k1 outscores k2 on the theory exam (merit).
//   - The batch cutoff (top-1 by merit) QUALIFIES k1, not k2.
//   - A backer then gifts k2 five times more money than k1 gets.
//   - k2 becomes the People's Champion (money) and the pot grows, but k1 remains
//     the merit leader / crown holder and the QUALIFIED cut is unchanged.
func TestFirewall_EndToEnd_SupportMovesPotNotMerit(t *testing.T) {
	ctx := context.Background()
	const comp = "naija-driver-2026"

	// ── Merit rail: the ONLY holder of a signer is the authorized theory adapter ──
	signer := newSigner(t, "theory-exam")
	meritRepo := newFakeMeritRepo(authFor(signer, "THEORY_EXAM"))
	merit := NewMeritService(meritRepo, &fakeAudit{})

	mkEntry := func(contestant string, norm float64) arena.SignedMeritEntry {
		p := arena.ScorePayload{
			CompetitionID: comp, ContestantID: contestant,
			SourceType: arena.SourceTheoryExam, AdapterID: signer.ID(),
			Stage: arena.StageTheoryB1, RubricVersion: "v1",
			RawScore: norm / 2, NormalizedScore: norm,
		}
		return arena.SignScore(signer, p, nil)
	}

	// Submit signed theory scores through the verify-before-append merit ledger.
	if err := merit.Append(ctx, "proctor", mkEntry("k1", 90)); err != nil {
		t.Fatalf("k1 signed theory score must append: %v", err)
	}
	if err := merit.Append(ctx, "proctor", mkEntry("k2", 70)); err != nil {
		t.Fatalf("k2 signed theory score must append: %v", err)
	}

	// leaderboard projects the signed merit ledger exactly as the
	// arena_merit_leaderboard matview does (sum of normalized score per contestant).
	leaderboard := func() []LeaderRow {
		agg := map[string]float64{}
		for _, e := range meritRepo.inserted {
			agg[e.Payload.ContestantID] += e.Payload.NormalizedScore
		}
		rows := make([]LeaderRow, 0, len(agg))
		for id, s := range agg {
			rows = append(rows, LeaderRow{ContestantID: id, Stage: arena.StageTheoryB1, TotalScore: s})
		}
		return rows
	}

	// ── Batch cutoff → QUALIFIED (merit-only, top-1) ─────────────────────────────
	rowsBefore := leaderboard()
	if !AdvancementQualifies(rowsBefore, "k1", 1) {
		t.Fatal("k1 must QUALIFY on merit (top-1)")
	}
	if AdvancementQualifies(rowsBefore, "k2", 1) {
		t.Fatal("k2 must NOT qualify — below the merit cut")
	}
	if got := MeritLeader(rowsBefore); got != "k1" {
		t.Fatalf("merit leader (crown) want k1, got %s", got)
	}
	meritEntriesBefore := len(meritRepo.inserted)

	// ── Money rail: Support holds NO signer, can only move money + tag rows ───────
	led := newFakeLedger()
	supportRepo := &fakeSupportRepo{}
	support := NewSupportService(supportRepo, led, fakeTier{3}, fakeCfg{Config{RequiredKYCTier: 1}}, &fakeAudit{})

	// Backers gift k2 (the merit loser) 5× what k1 gets.
	if err := support.Contribute(ctx, "backer-1", "idem-1", comp, "k2", 500000); err != nil {
		t.Fatalf("support to k2 must succeed: %v", err)
	}
	if err := support.Contribute(ctx, "backer-2", "idem-2", comp, "k1", 100000); err != nil {
		t.Fatalf("support to k1 must succeed: %v", err)
	}

	// Support DID move the pot and the People's Champion tally (a money display).
	if got := PotTotalKobo(supportRepo.rows); got != 600000 {
		t.Fatalf("pot total want 600000 kobo, got %d", got)
	}
	if champ, _ := PeoplesChampion(supportRepo.rows); champ != "k2" {
		t.Fatalf("People's Champion (money) want k2, got %s", champ)
	}

	// ── FIREWALL (NDC-1): merit / leaderboard / crown are UNCHANGED by the money ──
	if len(meritRepo.inserted) != meritEntriesBefore {
		t.Fatalf("Support must not mint merit entries: before=%d after=%d", meritEntriesBefore, len(meritRepo.inserted))
	}
	rowsAfter := leaderboard()
	if got := MeritLeader(rowsAfter); got != "k1" {
		t.Fatalf("crown must remain the merit leader k1 after support, got %s", got)
	}
	if !AdvancementQualifies(rowsAfter, "k1", 1) || AdvancementQualifies(rowsAfter, "k2", 1) {
		t.Fatal("the merit QUALIFIED cut must be unchanged by Support money")
	}
	// The single strongest statement: the money-funded People's Champion is NOT the
	// merit crown holder. If these were ever equal because of money, NDC-1 is broken.
	if champ, _ := PeoplesChampion(supportRepo.rows); champ == MeritLeader(rowsAfter) {
		t.Fatal("NDC-1 VIOLATED: the money-funded People's Champion became the merit crown")
	}
	// Advancement transitions are, by policy, driven by merit only.
	if !arena.AdvancementReadsMeritOnly(arena.StQualified) || !arena.AdvancementReadsMeritOnly(arena.StCrowned) {
		t.Fatal("advancement to QUALIFIED/CROWNED must read merit only")
	}
}
