// ── Spray (Phase 3) ──────────────────────────────────────────────────────────
// Instant celebratory transfer + leaderboard, wired conceptually into lives &
// events. NEW file alongside the P1 social lib (do NOT edit P1 files). Reuses the
// P1 social.constants helpers. AML velocity limits apply (NL-10).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { USE_MOCK, formatNaira, AML_DAILY_LIMIT_KOBO } from './constants/social.constants';

export { formatNaira };

// Spray is mounted by RegisterP2PMarket alongside p2pmarket (shared engine —
// see backend/internal/app/top5_p3_routes.go), NOT under Social Pay's own
// base. spray.Handler.Register(member, ...) receives the SAME member group as
// p2pmarket (finance.Group("/p2p")), so the full path is /api/finance/p2p/spray.
const SPRAY_BASE = '/api/finance/p2p/spray';

const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms));
function sprayIdempotencyKey(): string {
  return `spr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── NL-10 — spray is a real money transfer; velocity limits apply. ────────────
export const SPRAY_DISCLOSURE =
  'Spraying sends real money instantly to the creator or host. It counts toward ' +
  'your daily send limit. Spray responsibly.';

// Preset spray denominations (kobo).
export const SPRAY_PRESETS_KOBO = [50_000, 100_000, 200_000, 500_000, 1_000_000, 5_000_000];

export const SPRAY_DAILY_LIMIT_KOBO = AML_DAILY_LIMIT_KOBO;

// ── Types ──────────────────────────────────────────────────────────────────────
export interface SprayTarget {
  id:          string;
  /** 'live' | 'event' — where the spray surface is mounted. */
  context:     'live' | 'event';
  title:       string;          // live/event name
  hostHandle:  string;
  hostName:    string;
  avatarColor: string;
}

export interface SprayLeaderEntry {
  rank:        number;
  handle:      string;
  name:        string;
  avatarColor: string;
  totalKobo:   number;
  isYou?:      boolean;
}

export interface SprayInput {
  targetId:   string;
  amountKobo: number;
}

export interface SprayResult {
  ok:           boolean;
  id:           string;
  newTotalKobo: number;        // your running total for this target
}

// ── Mock fixtures ─────────────────────────────────────────────────────────────
const MOCK_TARGETS: SprayTarget[] = [
  { id: 'live_tope', context: 'live',  title: 'Tope Beats — Live Session', hostHandle: '@topebeats', hostName: 'Tope Beats', avatarColor: '#0051D5' },
  { id: 'evt_owanbe', context: 'event', title: 'Owanbe Night 2026',         hostHandle: '@laracooks', hostName: 'Lara',       avatarColor: '#16A34A' },
];

const MOCK_LEADERBOARD: SprayLeaderEntry[] = [
  { rank: 1, handle: '@bigchief', name: 'Big Chief',  avatarColor: '#EAB308', totalKobo: 25_000_000 },
  { rank: 2, handle: '@you',      name: 'You',         avatarColor: '#340075', totalKobo: 12_500_000, isYou: true },
  { rank: 3, handle: '@bisi',     name: 'Bisi',        avatarColor: '#0051D5', totalKobo: 8_000_000 },
  { rank: 4, handle: '@chidi',    name: 'Chidi',       avatarColor: '#48B8AC', totalKobo: 5_500_000 },
  { rank: 5, handle: '@ada',      name: 'Ada',         avatarColor: '#16A34A', totalKobo: 3_000_000 },
  { rank: 6, handle: '@femi',     name: 'Femi',        avatarColor: '#DC2626', totalKobo: 1_500_000 },
];

// ── API ─────────────────────────────────────────────────────────────────────
// MISSING BACKEND ENDPOINT: no GET /spray/targets/:id exists — the spray
// engine only exposes POST /spray (send) and GET /spray/leaderboard/:contextRef.
// Falls back to the mock target catalogue until a targets-read endpoint ships.
export async function getSprayTarget(id: string): Promise<SprayTarget> {
  await delay();
  return MOCK_TARGETS.find((t) => t.id === id) ?? MOCK_TARGETS[0];
}

// Backend: GET /spray/leaderboard/:contextRef → { success, leaderboard }.
// NOTE: contextRef is a required PATH param (not an optional query param).
export async function getLeaderboard(targetId?: string): Promise<SprayLeaderEntry[]> {
  if (USE_MOCK || !targetId) { await delay(); return MOCK_LEADERBOARD; }
  const res = await api.get(`${SPRAY_BASE}/leaderboard/${encodeURIComponent(targetId)}`);
  const rows = (res.data as { leaderboard?: Record<string, unknown>[] })?.leaderboard ?? [];
  return rows.map((r, i) => ({
    rank: Number(r.rank ?? i + 1),
    handle: String(r.handle ?? ''),
    name: String(r.name ?? r.handle ?? ''),
    avatarColor: '#340075',
    totalKobo: Number(r.total_kobo ?? 0),
    isYou: !!r.is_you,
  }));
}

// Backend: POST /spray expects { context_ref, amount_kobo } (Idempotency-Key)
// → { success, spray, new_total_kobo }.
export async function sendSpray(input: SprayInput): Promise<SprayResult> {
  if (USE_MOCK) {
    await delay();
    const me = MOCK_LEADERBOARD.find((e) => e.isYou);
    return { ok: true, id: `spr_${Date.now()}`, newTotalKobo: (me?.totalKobo ?? 0) + input.amountKobo };
  }
  const res = await api.post(
    `${SPRAY_BASE}`,
    { context_ref: input.targetId, amount_kobo: input.amountKobo },
    { headers: { 'Idempotency-Key': sprayIdempotencyKey() } },
  );
  const body = res.data as { spray?: { id?: string }; new_total_kobo?: number };
  return {
    ok: true,
    id: body.spray?.id ?? `spr_${Date.now()}`,
    newTotalKobo: Number(body.new_total_kobo ?? 0),
  };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
const KEYS = {
  target:      (id: string) => ['social', 'spray', 'target', id] as const,
  leaderboard: (id: string) => ['social', 'spray', 'leaderboard', id] as const,
};

export const useSprayTarget = (id: string) =>
  useQuery({ queryKey: KEYS.target(id), queryFn: () => getSprayTarget(id), enabled: !!id });

export const useSprayLeaderboard = (targetId = '') =>
  useQuery({ queryKey: KEYS.leaderboard(targetId), queryFn: () => getLeaderboard(targetId || undefined) });

export function useSendSpray(targetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountKobo: number) => sendSpray({ targetId, amountKobo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['social', 'spray', 'leaderboard'] }),
  });
}
