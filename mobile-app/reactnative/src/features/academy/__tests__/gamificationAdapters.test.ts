// Unit tests for the gamification profile adapter (Go → mobile). XP/streak are
// awarded server-side on assessment/exam completion; the profile read maps to the
// mobile shape, computing xpToNext from the backend level curve. Run: npm run test:academy

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { adaptGamificationProfile, xpThresholdForNextLevel, adaptChallenge, adaptChallenges, adaptBadge, adaptBadges } from '../gamificationAdapters.ts';

test('xpThresholdForNextLevel mirrors the backend curve (base 100, step 150)', () => {
  assert.equal(xpThresholdForNextLevel(1), 100, 'level 1 → 2 at 100 XP');
  assert.equal(xpThresholdForNextLevel(2), 350, '2*100 + 1*150');
  assert.equal(xpThresholdForNextLevel(3), 750, '3*100 + 3*150');
  assert.equal(xpThresholdForNextLevel(4), 1300, '4*100 + 6*150');
});

test('adaptGamificationProfile maps fields + computes xpToNext', () => {
  const p = adaptGamificationProfile({ user_id: 'u1', xp: 120, level: 2, streak_days: 5, freezes: 2, last_active: '2026-08-02' });
  assert.equal(p.level, 2);
  assert.equal(p.xp, 120);
  assert.equal(p.xpToNext, 350 - 120, 'threshold(2) − xp');
  assert.equal(p.streakDays, 5);
  assert.equal(p.freezeTokens, 2);
  assert.equal(p.rank, undefined, 'rank unset until leaderboard is wired');
});

test('adaptGamificationProfile: fresh profile (0 XP, level 1)', () => {
  const p = adaptGamificationProfile({ user_id: 'u', xp: 0, level: 1, streak_days: 0, freezes: 0 });
  assert.equal(p.level, 1);
  assert.equal(p.xp, 0);
  assert.equal(p.xpToNext, 100, 'full level-1 gap');
  assert.equal(p.streakDays, 0);
  assert.equal(p.freezeTokens, 0);
});

test('adaptGamificationProfile clamps xpToNext at 0 when past the threshold', () => {
  // Defensive: xp beyond the current level boundary (e.g. just-levelled edge) → 0.
  const p = adaptGamificationProfile({ user_id: 'u', xp: 500, level: 2, streak_days: 0, freezes: 0 });
  assert.equal(p.xpToNext, 0);
});

test('adaptGamificationProfile tolerates missing/garbage values', () => {
  const p = adaptGamificationProfile({ user_id: 'u', xp: -5, level: 0, streak_days: -1, freezes: -2 });
  assert.equal(p.level, 1);
  assert.equal(p.xp, 0);
  assert.equal(p.streakDays, 0);
  assert.equal(p.freezeTokens, 0);
});

test('adaptChallenge maps a Go row (kind→cadence, criteria→target/reward/desc)', () => {
  const c = adaptChallenge({
    id: 'c1', code: 'DAILY-PRACTICE', name: 'Daily Practice', kind: 'daily',
    criteria: { target: 3, reward_points: 50, description: 'Complete 3 practice sets today' }, status: 'active',
  });
  assert.equal(c.id, 'c1');
  assert.equal(c.title, 'Daily Practice');
  assert.equal(c.cadence, 'daily');
  assert.equal(c.target, 3);
  assert.equal(c.rewardPoints, 50);
  assert.equal(c.description, 'Complete 3 practice sets today');
  assert.equal(c.progress, 0, 'no server progress → 0');
  assert.equal(c.completed, false);
});

test('adaptChallenge reads server progress + caps at target + completed', () => {
  const base = { id: 'c', code: 'C', name: 'C', kind: 'daily', criteria: { target: 3 } };
  const partial = adaptChallenge({ ...base, progress: 2, completed: false });
  assert.equal(partial.progress, 2);
  assert.equal(partial.completed, false);
  const done = adaptChallenge({ ...base, progress: 5, completed: true });
  assert.equal(done.progress, 3, 'progress capped at target');
  assert.equal(done.completed, true);
});

test('adaptChallenge: unknown kind → daily, empty criteria → target defaults 1', () => {
  const c = adaptChallenge({ id: 'x', code: 'X', name: 'X', kind: 'monthly' });
  assert.equal(c.cadence, 'daily', 'invalid kind falls back to a valid cadence');
  assert.equal(c.target, 1);
  assert.equal(c.rewardPoints, 0);
  assert.equal(c.description, '');
});

test('adaptChallenges tolerates undefined + preserves sponsor', () => {
  assert.deepEqual(adaptChallenges(undefined), []);
  const c = adaptChallenges([{ id: 's', code: 'S', name: 'Sponsored', kind: 'sponsor', sponsor_id: 'spon-1' }]);
  assert.equal(c[0].cadence, 'sponsor');
  assert.equal(c[0].sponsor, 'spon-1');
});

test('adaptBadge maps a catalogue view (earned) → mobile Badge', () => {
  const b = adaptBadge({ id: 'b1', code: 'EXAM-DEBUT', name: 'Exam Debut', description: 'Complete your first mock exam.', icon: 'graduation-cap', earned: true, earned_at: '2026-08-02T10:00:00Z' });
  assert.equal(b.id, 'b1');
  assert.equal(b.name, 'Exam Debut');
  assert.equal(b.description, 'Complete your first mock exam.');
  assert.equal(b.icon, 'graduation-cap');
  assert.equal(b.earned, true);
  assert.equal(b.earnedAt, '2026-08-02T10:00:00Z');
});

test('adaptBadge: unearned badge → earned false, no earnedAt, icon fallback', () => {
  const b = adaptBadge({ id: 'b2', code: 'ON-A-ROLL', name: 'On a Roll' });
  assert.equal(b.earned, false);
  assert.equal(b.earnedAt, undefined);
  assert.equal(b.icon, 'award', 'missing icon falls back');
  assert.equal(b.description, '');
});

test('adaptBadges tolerates undefined', () => {
  assert.deepEqual(adaptBadges(undefined), []);
});
