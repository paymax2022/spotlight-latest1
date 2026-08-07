package gamification

import (
	"testing"
	"time"
)

// These tests cover the PURE decision helpers in logic.go (no DB): the XP→level
// curve, the streak/freeze state machine, freeze granting, and badge criteria
// idempotency. All thresholds come from Config, never hardcoded constants.

func testCfg() Config { return DefaultConfig() }

// ── levelForXP ───────────────────────────────────────────────────────────────────

func TestLevelForXP(t *testing.T) {
	cfg := testCfg() // LevelBaseXP=100, LevelStepXP=150, MaxLevel=100

	// threshold(L) to REACH level L+1 uses the curve in logic.go:
	//   next(level) = level*Base + (level-1)*level/2 * Step
	// level 1→2 boundary = 1*100 + 0 = 100
	// level 2→3 boundary = 2*100 + 1*150 = 350
	cases := []struct {
		xp   int64
		want int
	}{
		{-50, 1}, // negative clamps to 0 → level 1
		{0, 1},
		{99, 1},
		{100, 2}, // exactly at the level-2 boundary
		{349, 2},
		{350, 3}, // level-3 boundary
	}
	for _, c := range cases {
		if got := levelForXP(c.xp, cfg); got != c.want {
			t.Errorf("levelForXP(%d) = %d want %d", c.xp, got, c.want)
		}
	}
}

func TestLevelForXP_ClampsToMaxLevel(t *testing.T) {
	cfg := Config{LevelBaseXP: 100, LevelStepXP: 150, MaxLevel: 3, FreezeMaxStored: 3}
	if got := levelForXP(1_000_000_000, cfg); got != cfg.MaxLevel {
		t.Errorf("levelForXP huge = %d want clamp to MaxLevel %d", got, cfg.MaxLevel)
	}
}

func TestXPForNextLevel(t *testing.T) {
	cfg := testCfg()
	if got := xpForNextLevel(1, cfg); got != 100 {
		t.Errorf("xpForNextLevel(1) = %d want 100", got)
	}
	if got := xpForNextLevel(2, cfg); got != 350 {
		t.Errorf("xpForNextLevel(2) = %d want 350", got)
	}
	// at MaxLevel returns -1
	maxCfg := Config{LevelBaseXP: 100, LevelStepXP: 150, MaxLevel: 5}
	if got := xpForNextLevel(5, maxCfg); got != -1 {
		t.Errorf("xpForNextLevel at max = %d want -1", got)
	}
}

// ── applyStreak ──────────────────────────────────────────────────────────────────

func day(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

func TestApplyStreak_FirstEver(t *testing.T) {
	out := applyStreak(0, 0, "", day("2026-06-27"), testCfg())
	if out.StreakDays != 1 || out.NewLastActive != "2026-06-27" {
		t.Errorf("first streak = %+v want streak 1 on 2026-06-27", out)
	}
}

func TestApplyStreak_SameDayIdempotent(t *testing.T) {
	out := applyStreak(5, 2, "2026-06-27", day("2026-06-27"), testCfg())
	if out.StreakDays != 5 || out.Freezes != 2 {
		t.Errorf("same-day tick must be a no-op, got %+v", out)
	}
}

func TestApplyStreak_ConsecutiveDayExtends(t *testing.T) {
	out := applyStreak(5, 0, "2026-06-26", day("2026-06-27"), testCfg())
	if out.StreakDays != 6 || out.FreezeUsed {
		t.Errorf("+1 day should extend to 6 with no freeze, got %+v", out)
	}
}

func TestApplyStreak_GapWithFreezeBridges(t *testing.T) {
	out := applyStreak(5, 1, "2026-06-25", day("2026-06-27"), testCfg()) // 2-day gap
	if out.StreakDays != 6 || out.Freezes != 0 || !out.FreezeUsed {
		t.Errorf("gap with freeze should bridge (streak 6, freeze spent), got %+v", out)
	}
}

func TestApplyStreak_GapNoFreezeResets(t *testing.T) {
	out := applyStreak(5, 0, "2026-06-25", day("2026-06-27"), testCfg()) // 2-day gap, no freeze
	if out.StreakDays != 1 || out.FreezeUsed {
		t.Errorf("gap without freeze should reset to 1, got %+v", out)
	}
}

// ── grantFreeze ──────────────────────────────────────────────────────────────────

func TestGrantFreeze_CappedAtConfig(t *testing.T) {
	cfg := Config{FreezeMaxStored: 3}
	if got := grantFreeze(0, cfg); got != 1 {
		t.Errorf("grantFreeze(0) = %d want 1", got)
	}
	if got := grantFreeze(3, cfg); got != 3 {
		t.Errorf("grantFreeze at cap = %d want 3 (capped)", got)
	}
}

// ── badgeEarned (idempotency-adjacent: deterministic, no auto-grant on empty) ─────

func TestBadgeEarned_EmptyCriteriaNeverEarns(t *testing.T) {
	if badgeEarned(map[string]any{}, BadgeStats{XP: 9999, Level: 99}) {
		t.Errorf("empty criteria must never auto-earn a badge")
	}
}

func TestBadgeEarned_MinXP(t *testing.T) {
	crit := map[string]any{"min_xp": float64(500)}
	if badgeEarned(crit, BadgeStats{XP: 499}) {
		t.Errorf("below min_xp should not earn")
	}
	if !badgeEarned(crit, BadgeStats{XP: 500}) {
		t.Errorf("at min_xp should earn")
	}
}

func TestBadgeEarned_MultiCriteriaAllRequired(t *testing.T) {
	crit := map[string]any{"min_xp": float64(500), "min_streak": float64(7)}
	// XP ok, streak short → not earned (all listed criteria must pass).
	if badgeEarned(crit, BadgeStats{XP: 600, StreakDays: 3}) {
		t.Errorf("all criteria must be satisfied; streak short should block")
	}
	if !badgeEarned(crit, BadgeStats{XP: 600, StreakDays: 7}) {
		t.Errorf("both criteria satisfied should earn")
	}
}

func TestBadgeEarned_CounterCriterion(t *testing.T) {
	crit := map[string]any{"counter": map[string]any{"name": "lessons_completed", "min": float64(10)}}
	if badgeEarned(crit, BadgeStats{Counters: map[string]int64{"lessons_completed": 9}}) {
		t.Errorf("below counter min should not earn")
	}
	if !badgeEarned(crit, BadgeStats{Counters: map[string]int64{"lessons_completed": 10}}) {
		t.Errorf("at counter min should earn")
	}
}

// TestBadgeEarned_Idempotent confirms the criteria check is a pure function of its
// inputs — the same stats yield the same decision every time (the grant itself is
// made idempotent by the (user_id, badge_id) PK at the repo layer).
func TestBadgeEarned_Idempotent(t *testing.T) {
	crit := map[string]any{"min_level": float64(5)}
	stats := BadgeStats{Level: 5}
	first := badgeEarned(crit, stats)
	for i := 0; i < 5; i++ {
		if badgeEarned(crit, stats) != first {
			t.Fatalf("badgeEarned must be deterministic across calls")
		}
	}
	if !first {
		t.Errorf("level 5 meets min_level 5 — expected earned")
	}
}
