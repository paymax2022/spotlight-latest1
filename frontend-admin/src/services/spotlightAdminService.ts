// ── Admin — Spotlight Wealth content management ───────────────────────────────
// Wires to the real Go backend: content-authoring mutations live under
// /api/v1/spotlight/admin (backend/internal/spotlightwealth/admin.go,
// RBAC-gated on "spotlight.admin.manage"); list reads (videos / challenges /
// campaigns) live on the module root /api/v1/spotlight (backend/internal/
// spotlightwealth/handler.go) since admin.go has no duplicate GET list routes.
//
// MONEY: challenge reward amounts are BIGINT kobo (int64) on the wire
// (AdminChallengeInput.rewardKobo) — never a float, never a string for math
// (Iron Rule: money handling). Display-only conversion to ₦ happens here via
// formatNaira, mirroring associationAdminService's convention exactly.

import { env } from '@/config/env';
import { operationKey } from './idempotency';

function adminBase(): string {
  return `${env.apiBaseUrl.replace(/\/$/, '')}/spotlight/admin`;
}
function moduleBase(): string {
  return `${env.apiBaseUrl.replace(/\/$/, '')}/spotlight`;
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

async function getJson<T>(path: string, base: 'admin' | 'module' = 'admin'): Promise<T> {
  const root = base === 'admin' ? adminBase() : moduleBase();
  const res = await fetch(`${root}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendJson<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, {
    method,
    headers: { ...authHeaders(), 'Idempotency-Key': operationKey(method, path) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function del(path: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${adminBase()}${path}`, {
    method: 'DELETE',
    headers: { ...authHeaders(), 'Idempotency-Key': operationKey('DELETE', path) },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as { ok: boolean };
}

export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Types (mirror backend/internal/spotlightwealth/model.go + admin.go DTOs) ──
export type SpotlightTopic = 'budgeting' | 'investing-basics' | 'crypto' | 'stocks' | 'saving' | 'mindset';
export type ChallengeKind = 'literacy' | 'quiz' | 'savings';

export interface Money {
  amount: number; // major units (Naira) — display pair only
  currency: string;
}

export interface FinanceVideo {
  id: string;
  title: string;
  creator: string;
  thumbnailColor: string;
  durationMins: number;
  topic: SpotlightTopic;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  reward: Money;
  endsAt: string;
  joined: boolean;
  kind: ChallengeKind;
}

export interface Campaign {
  id: string;
  title: string;
  description: string;
  iconColor: string;
  cta: string;
}

export interface AdminVideoInput {
  id?: string;
  title: string;
  creator: string;
  thumbnailColor?: string;
  durationMins?: number;
  topic: SpotlightTopic;
  sortOrder?: number;
  published?: boolean | null;
}

// AdminChallengeInput.rewardKobo is BIGINT kobo (integer minor units) — never
// a float. Callers must send whole kobo, e.g. Math.round(naira * 100).
export interface AdminChallengeInput {
  id?: string;
  title: string;
  description?: string;
  rewardKobo: number;
  currency?: string;
  endsAt: string; // RFC3339
  kind: ChallengeKind;
  published?: boolean | null;
}

export interface AdminCampaignInput {
  id?: string;
  title: string;
  description?: string;
  iconColor?: string;
  cta?: string;
  sortOrder?: number;
  published?: boolean | null;
}

// ── Videos ────────────────────────────────────────────────────────────────────
// GET /videos is on the module root (routes.go) — there is no admin-only
// "list including unpublished" endpoint for videos, unlike learn paths.
export async function listVideos(topic?: string): Promise<FinanceVideo[]> {
  const qs = topic ? `?topic=${encodeURIComponent(topic)}` : '';
  return getJson<FinanceVideo[]>(`/videos${qs}`, 'module');
}
export async function createVideo(input: AdminVideoInput): Promise<FinanceVideo> {
  return sendJson<FinanceVideo>('POST', '/videos', input);
}
export async function updateVideo(id: string, input: AdminVideoInput): Promise<FinanceVideo> {
  return sendJson<FinanceVideo>('PUT', `/videos/${id}`, input);
}
export async function deleteVideo(id: string): Promise<{ ok: boolean }> {
  return del(`/videos/${id}`);
}

// ── Challenges ────────────────────────────────────────────────────────────────
export async function listChallenges(): Promise<Challenge[]> {
  return getJson<Challenge[]>('/challenges', 'module');
}
export async function createChallenge(input: AdminChallengeInput): Promise<Challenge> {
  return sendJson<Challenge>('POST', '/challenges', input);
}
export async function updateChallenge(id: string, input: AdminChallengeInput): Promise<Challenge> {
  return sendJson<Challenge>('PUT', `/challenges/${id}`, input);
}
export async function deleteChallenge(id: string): Promise<{ ok: boolean }> {
  return del(`/challenges/${id}`);
}

// ── Campaigns ─────────────────────────────────────────────────────────────────
export async function listCampaigns(): Promise<Campaign[]> {
  return getJson<Campaign[]>('/campaigns', 'module');
}
export async function createCampaign(input: AdminCampaignInput): Promise<Campaign> {
  return sendJson<Campaign>('POST', '/campaigns', input);
}
export async function updateCampaign(id: string, input: AdminCampaignInput): Promise<Campaign> {
  return sendJson<Campaign>('PUT', `/campaigns/${id}`, input);
}
export async function deleteCampaign(id: string): Promise<{ ok: boolean }> {
  return del(`/campaigns/${id}`);
}
