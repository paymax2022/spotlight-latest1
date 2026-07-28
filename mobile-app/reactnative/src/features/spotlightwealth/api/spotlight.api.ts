// ── Spotlight Wealth — API wrapper ───────────────────────────────────────────
// Typed data layer the screens code against. Mock-flagged like crypto.api.ts.
//
// GO-LIVE (2026-07): the real backend module now EXISTS —
// backend/internal/spotlightwealth (service+handler+routes) is registered on the
// Go router under /api/v1/spotlight/* (see
// backend/internal/app/spotlightwealth_routes.go), backed by the spotlight_*
// tables (migration 20260912000100_spotlightwealth.sql). Content matches these
// mock fixtures. Challenge completion (POST /challenges/:id/complete, not yet
// surfaced in this wrapper) pays WALLET CREDIT via the finance ledger under an
// Idempotency-Key — never a guaranteed return.
//
// REMAINING DEPENDENCY before flipping EXPO_PUBLIC_SPOTLIGHT_USE_MOCK=false: the
// Next gateway only rewrites /api/finance/* to Go; /api/v1/* needs a frontend-web
// proxy. Add frontend-web/app/api/v1/spotlight/[...path]/route.ts (mirror the
// app/api/v1/invest proxy) forwarding to the Go backend's /api/v1/spotlight/*.
// Once it lands, flip the flag — the live paths below already match the Go routes.
//
// STRICT RULES honoured here (docs/crypto/product.md → strict rules):
//  • Leaderboard returns LEARNING points, never profit.
//  • Challenge rewards are wallet credit, never guaranteed returns.
//  • Nothing here recommends a security or surfaces a celebrity buy-signal.

import { api } from '@/api/client';
import {
  MOCK_CAMPAIGNS,
  MOCK_CHALLENGES,
  MOCK_LEADERBOARD,
  MOCK_REWARD_WALLET,
  MOCK_VIDEOS,
} from './spotlight.mock';
import type {
  Campaign,
  Challenge,
  FinanceVideo,
  LeaderboardEntry,
  RewardWallet,
  SpotlightTopic,
} from '../types/spotlight.types';

// ─── Feature flag: flip to false once real endpoints are ready ────────────────
const USE_MOCK = (process.env.EXPO_PUBLIC_SPOTLIGHT_USE_MOCK ?? 'true').toLowerCase() !== 'false';

/** Simulated network latency so loading states render in mock mode. */
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

// Mock challenges are mutable so joinChallenge persists `joined` within a session.
const mockChallenges: Challenge[] = MOCK_CHALLENGES.map((c) => ({ ...c }));

// ─── Finance videos (creator education — never recommendations) ───────────────

export async function getVideos(topic?: SpotlightTopic): Promise<FinanceVideo[]> {
  if (USE_MOCK) {
    await delay();
    return topic ? MOCK_VIDEOS.filter((v) => v.topic === topic) : [...MOCK_VIDEOS];
  }
  return unwrap<FinanceVideo[]>(await api.get('/api/v1/spotlight/videos', { params: { topic } }));
}

// ─── Challenges (learn-and-earn; reward = wallet credit) ──────────────────────

export async function getChallenges(): Promise<Challenge[]> {
  if (USE_MOCK) {
    await delay();
    return mockChallenges.map((c) => ({ ...c }));
  }
  return unwrap<Challenge[]>(await api.get('/api/v1/spotlight/challenges'));
}

export async function getChallenge(id: string): Promise<Challenge> {
  if (USE_MOCK) {
    await delay(220);
    const found = mockChallenges.find((c) => c.id === id);
    if (!found) throw new Error('Challenge not found');
    return { ...found };
  }
  return unwrap<Challenge>(await api.get(`/api/v1/spotlight/challenges/${id}`));
}

export async function joinChallenge(id: string): Promise<Challenge> {
  if (USE_MOCK) {
    await delay(600);
    const found = mockChallenges.find((c) => c.id === id);
    if (!found) throw new Error('Challenge not found');
    found.joined = true;
    return { ...found };
  }
  return unwrap<Challenge>(await api.post(`/api/v1/spotlight/challenges/${id}/join`, {}));
}

// ─── Learning leaderboard (LEARNING points — explicitly NOT profit) ───────────

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_LEADERBOARD].sort((a, b) => a.rank - b.rank);
  }
  return unwrap<LeaderboardEntry[]>(await api.get('/api/v1/spotlight/leaderboard', { params: { metric: 'learning_points' } }));
}

// ─── Reward wallet (credit earned from learning) ──────────────────────────────

export async function getRewardWallet(): Promise<RewardWallet> {
  if (USE_MOCK) {
    await delay(280);
    return {
      balance: { ...MOCK_REWARD_WALLET.balance },
      history: MOCK_REWARD_WALLET.history.map((h) => ({ ...h })),
    };
  }
  return unwrap<RewardWallet>(await api.get('/api/v1/spotlight/reward-wallet'));
}

// ─── Campaigns (creator / event-led education programmes) ─────────────────────

export async function getCampaigns(): Promise<Campaign[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_CAMPAIGNS];
  }
  return unwrap<Campaign[]>(await api.get('/api/v1/spotlight/campaigns'));
}

export async function getCampaign(id: string): Promise<Campaign> {
  if (USE_MOCK) {
    await delay(220);
    const found = MOCK_CAMPAIGNS.find((c) => c.id === id);
    if (!found) throw new Error('Campaign not found');
    return { ...found };
  }
  return unwrap<Campaign>(await api.get(`/api/v1/spotlight/campaigns/${id}`));
}
