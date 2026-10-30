// Mapping of the live Direct Rewards engine payloads onto the Earn hub home screen.
// The failure modes matter more than the happy path here: a number that is wrong but
// plausible is worse than one that is plainly unavailable.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapSnapshot, mapMilestone, milestoneProgress, tierLabel, moduleLabel, mapEarningStatus, buildActivity,
} from '@/features/referral/home/homeMap';
import type { EngineDashboard, EngineEarning, EngineReferral } from '@/features/referral/home/engine';

const dash = (over: Partial<EngineDashboard> = {}): EngineDashboard => ({
  code: 'AB123', current_tier: 'bronze', current_rate: 0.1, active_referral_count: 2,
  this_month_earned_kobo: 70_000, lifetime_earned_kobo: 900_000, ...over,
});

describe('mapSnapshot', () => {
  it('maps the per-state rewards summary', () => {
    const { snapshot, unavailable } = mapSnapshot(dash(), {
      total_earned_kobo: 500_000, eligible_kobo: 150_000, paid_kobo: 200_000, clawed_back_kobo: 50_000,
      by_state: { pending: 50_000, vesting: 100_000 },
    });
    assert.equal(unavailable, false);
    assert.deepEqual(snapshot, {
      eligibleKobo: 150_000, pendingKobo: 50_000, vestingKobo: 100_000, paidKobo: 200_000,
      clawedBackKobo: 50_000, lifetimeEarnedKobo: 500_000, currency: 'NGN',
    });
  });

  it('flags the breakdown unavailable when the rewards call failed, and never invents Paid', () => {
    const { snapshot, unavailable } = mapSnapshot(dash(), null);
    assert.equal(unavailable, true);
    // This month's earnings must NOT stand in for "paid to wallet".
    assert.equal(snapshot.paidKobo, 0);
    assert.equal(snapshot.eligibleKobo, 0);
    // The dashboard's own lifetime figure is real and still shown.
    assert.equal(snapshot.lifetimeEarnedKobo, 900_000);
  });

  it('truncates fractional kobo rather than rounding up money', () => {
    const { snapshot } = mapSnapshot(dash(), { eligible_kobo: 100.9, paid_kobo: 5.5, by_state: { vesting: 2.7 } });
    assert.equal(snapshot.eligibleKobo, 100);
    assert.equal(snapshot.paidKobo, 5);
    assert.equal(snapshot.vestingKobo, 2);
  });
});

describe('mapMilestone / milestoneProgress', () => {
  it('maps a valid milestone', () => {
    assert.deepEqual(mapMilestone({ threshold: 10, bonus_kobo: 500_000, remaining: 3 }), { threshold: 10, bonusKobo: 500_000, remaining: 3 });
  });
  it('is null when absent or malformed', () => {
    assert.equal(mapMilestone(undefined), null);
    assert.equal(mapMilestone({ threshold: 'x', bonus_kobo: 1, remaining: 1 } as never), null);
    assert.equal(mapMilestone({ threshold: 0, bonus_kobo: 1, remaining: 0 }), null);
  });
  it('reports progress toward the threshold', () => {
    assert.deepEqual(milestoneProgress({ threshold: 10, bonusKobo: 500_000, remaining: 3 }), { done: 7, pct: 70 });
  });
  it('clamps when remaining exceeds the threshold or is negative', () => {
    assert.deepEqual(milestoneProgress({ threshold: 10, bonusKobo: 1, remaining: 15 }), { done: 0, pct: 0 });
    assert.deepEqual(milestoneProgress({ threshold: 10, bonusKobo: 1, remaining: -2 }), { done: 10, pct: 100 });
  });
});

describe('tierLabel / moduleLabel', () => {
  it('title-cases a tier and tolerates empties', () => {
    assert.equal(tierLabel('gold'), 'Gold');
    assert.equal(tierLabel('ROOKIE'), 'Rookie');
    assert.equal(tierLabel(''), null);
    assert.equal(tierLabel(undefined), null);
  });
  it('humanises a module key', () => {
    assert.equal(moduleLabel('bills'), 'Bills');
    assert.equal(moduleLabel('cable_tv'), 'Cable tv');
    assert.equal(moduleLabel(''), '');
  });
});

describe('mapEarningStatus', () => {
  it('maps engine statuses onto ledger states, case-insensitively', () => {
    assert.equal(mapEarningStatus('PENDING'), 'pending');
    // CREDITED = credited to the referral balance (still withdrawable), not paid out.
    assert.equal(mapEarningStatus('credited'), 'earned');
    assert.equal(mapEarningStatus('paid'), 'paid');
    assert.equal(mapEarningStatus('reversed'), 'clawed_back');
    assert.equal(mapEarningStatus('weird'), 'earned');
  });
});

describe('buildActivity', () => {
  const earning = (over: Partial<EngineEarning>): EngineEarning => ({
    id: 'e1', referred_user_id: 'u1', module: 'bills', margin_kobo: 1000, applied_rate: 0.1, reward_kobo: 5000,
    status: 'vesting', created_at: '2026-10-20T10:00:00Z', ...over,
  });
  const ref = (over: Partial<EngineReferral>): EngineReferral => ({
    referred_user_id: 'u1', masked_contact: 'am***@gmail.com', joined_at: '2026-10-21T09:00:00Z', active: false,
    lifetime_earned_kobo: 0, ...over,
  });

  it('merges signups and rewards, newest first', () => {
    const items = buildActivity([earning({})], [ref({})]);
    assert.deepEqual(items.map((i) => i.kind), ['signup', 'reward']);
  });

  it('writes readable rewards, not raw "module · status"', () => {
    const [r] = buildActivity([earning({ module: 'bills', status: 'vesting' })], []);
    assert.equal(r.title, 'Reward earned');
    assert.equal(r.detail, 'Bills');
    assert.equal(r.state, 'vesting');
    assert.equal(r.amountKobo, 5000);
  });

  it('shows a reversed reward as a clawback', () => {
    const [r] = buildActivity([earning({ status: 'reversed' })], []);
    assert.equal(r.kind, 'clawback');
    assert.equal(r.title, 'Reward reversed');
    assert.equal(r.state, 'clawed_back');
  });

  it('describes a signup by who joined and whether they are active', () => {
    const [a, b] = buildActivity([], [
      ref({ referred_user_id: 'a', active: true, joined_at: '2026-10-22T00:00:00Z' }),
      ref({ referred_user_id: 'b', active: false, joined_at: '2026-10-21T00:00:00Z' }),
    ]);
    assert.equal(a.title, 'am***@gmail.com joined');
    assert.match(a.detail, /qualifying purchase/i);
    assert.match(b.detail, /signed up/i);
    assert.equal(a.amountKobo, undefined);
  });

  it('gives every row a unique id even when a person has both a signup and a reward', () => {
    const items = buildActivity([earning({ id: 'x', referred_user_id: 'u1' })], [ref({ referred_user_id: 'u1' })]);
    assert.equal(new Set(items.map((i) => i.id)).size, 2);
  });

  it('puts rows with an unreadable date last and caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => earning({ id: `e${i}`, created_at: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z` }));
    assert.equal(buildActivity(many, [], 20).length, 20);
    const items = buildActivity([earning({ id: 'bad', created_at: 'nope' }), earning({ id: 'ok' })], []);
    assert.equal(items[items.length - 1].id, 'e:bad');
  });

  it('is empty with nothing to show', () => {
    assert.deepEqual(buildActivity([], []), []);
  });
});
