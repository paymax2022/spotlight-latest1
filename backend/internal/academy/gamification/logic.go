package gamification

import "time"

// This file holds PURE decision logic — no DB, no side effects, fully unit-testable.
// Every threshold comes from Config (caller-supplied), never a hardcoded constant.

// levelForXP returns the level for a given cumulative XP under the configured curve.
//
// Curve: the XP required to *reach* level L (L >= 1) is
//
//	threshold(L) = cfg.LevelBaseXP*(L-1) + cfg.LevelStepXP*((L-1)*(L-2)/2)
//
// i.e. level 1 starts at 0 XP, and each subsequent level costs LevelBaseXP plus a
// linearly growing LevelStepXP increment. Level is clamped to [1, cfg.MaxLevel].
func levelForXP(xp int64, cfg Config) int {
	if xp < 0 {
		xp = 0
	}
	level := 1
	for level < cfg.MaxLevel {
		next := int64(level)*cfg.LevelBaseXP + int64((level-1)*level/2)*cfg.LevelStepXP
		if xp < next {
			break
		}
		level++
	}
	return level
}

// xpForNextLevel returns the cumulative XP threshold to reach (currentLevel+1).
// Returns -1 when already at MaxLevel.
func xpForNextLevel(currentLevel int, cfg Config) int64 {
	if currentLevel >= cfg.MaxLevel {
		return -1
	}
	l := currentLevel // threshold to reach level (currentLevel+1)
	return int64(l)*cfg.LevelBaseXP + int64((l-1)*l/2)*cfg.LevelStepXP
}

// StreakOutcome is the pure result of evaluating a streak tick.
type StreakOutcome struct {
	StreakDays   int
	Freezes      int
	FreezeUsed   bool
	NewLastActive string // YYYY-MM-DD
}

// applyStreak computes the next streak state given the prior state and today's
// date. Daily-goal driven: calling this represents "the learner met today's goal".
//
// Rules (pure, deterministic):
//   - same day as lastActive          → no change (idempotent within a day).
//   - exactly +1 day                  → streak extends by 1.
//   - gap of >1 day, freeze available → ONE freeze token is spent to bridge the
//     gap and the streak extends by 1 (only bridges a single missed day window).
//   - gap of >1 day, no freeze        → streak resets to 1.
//   - empty lastActive (first ever)   → streak starts at 1.
func applyStreak(prevStreak, prevFreezes int, lastActive string, today time.Time, cfg Config) StreakOutcome {
	todayStr := today.Format("2006-01-02")
	if lastActive == todayStr {
		return StreakOutcome{StreakDays: prevStreak, Freezes: prevFreezes, NewLastActive: todayStr}
	}
	if lastActive == "" {
		return StreakOutcome{StreakDays: 1, Freezes: prevFreezes, NewLastActive: todayStr}
	}
	last, err := time.Parse("2006-01-02", lastActive)
	if err != nil {
		return StreakOutcome{StreakDays: 1, Freezes: prevFreezes, NewLastActive: todayStr}
	}
	gapDays := int(today.Sub(last).Hours() / 24)
	if gapDays <= 0 {
		// Clock skew / same-day fallback — treat as same day, no change.
		return StreakOutcome{StreakDays: prevStreak, Freezes: prevFreezes, NewLastActive: todayStr}
	}
	if gapDays == 1 {
		return StreakOutcome{StreakDays: prevStreak + 1, Freezes: prevFreezes, NewLastActive: todayStr}
	}
	// gapDays >= 2: a day was missed. Spend a freeze if available, else reset.
	if prevFreezes > 0 {
		return StreakOutcome{
			StreakDays:    prevStreak + 1,
			Freezes:       prevFreezes - 1,
			FreezeUsed:    true,
			NewLastActive: todayStr,
		}
	}
	return StreakOutcome{StreakDays: 1, Freezes: prevFreezes, NewLastActive: todayStr}
}

// grantFreeze adds a freeze token up to the configured cap (pure).
func grantFreeze(prevFreezes int, cfg Config) int {
	n := prevFreezes + 1
	if n > cfg.FreezeMaxStored {
		n = cfg.FreezeMaxStored
	}
	return n
}

// BadgeStats is the engagement snapshot a badge criterion is evaluated against.
// All fields are non-monetary engagement signals.
type BadgeStats struct {
	XP         int64
	Level      int
	StreakDays int
	Counters   map[string]int64 // arbitrary named counters, e.g. "lessons_completed"
}

// badgeEarned reports whether the given criteria are satisfied by stats. Criteria
// is data (from academy_badges.criteria jsonb) — supported keys:
//
//	{"min_xp": N}            cumulative XP at least N
//	{"min_level": N}         level at least N
//	{"min_streak": N}        streak_days at least N
//	{"counter": {"name": "lessons_completed", "min": N}}
//
// An empty/unknown criteria object is never auto-earned (returns false) to avoid
// accidentally granting badges with no gate.
func badgeEarned(criteria map[string]any, stats BadgeStats) bool {
	if len(criteria) == 0 {
		return false
	}
	matchedAny := false
	if v, ok := numFromAny(criteria["min_xp"]); ok {
		matchedAny = true
		if stats.XP < int64(v) {
			return false
		}
	}
	if v, ok := numFromAny(criteria["min_level"]); ok {
		matchedAny = true
		if int64(stats.Level) < int64(v) {
			return false
		}
	}
	if v, ok := numFromAny(criteria["min_streak"]); ok {
		matchedAny = true
		if int64(stats.StreakDays) < int64(v) {
			return false
		}
	}
	if c, ok := criteria["counter"].(map[string]any); ok {
		name, _ := c["name"].(string)
		min, hasMin := numFromAny(c["min"])
		if name != "" && hasMin {
			matchedAny = true
			if stats.Counters[name] < int64(min) {
				return false
			}
		}
	}
	return matchedAny
}

// numFromAny coerces a JSON-decoded number (float64) or int into float64.
func numFromAny(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return 0, false
	}
}
