// ── Admin — Contest parent/child hierarchy + maker-checker promotion ─────────
//
// Backend: backend/internal/connect/voting/promotion_{handlers,models,service,
// repo}.go, mounted via RegisterPromotionAdmin onto the SAME admin group
// RegisterAdmin uses (backend/internal/app/connect_money_routes.go), i.e. the
// full live prefix is /api/connect/admin — same base as connectAdminService.ts
// / connectNetworkAdminService.ts. Gated behind FEATURE_CONTEST_PROMOTION_ENABLED
// (off by default) — with the flag off, RegisterPromotionAdmin never registers
// these routes at all, so every call below 404s until an operator flips it.
//
// CASING — verified against promotion_models.go's json tags directly, not
// assumed from any other Connect service (this codebase mixes both
// conventions per-file/per-endpoint — see connectAdminService.ts for
// snake_case bodies and connectNetworkAdminService.ts for camelCase bodies).
// Request bodies here are camelCase (CreatePartnerRequest/UpdatePartnerRequest/
// RequestPromotionRequest/RejectPromotionRequest json tags: contactEmail,
// contactPhone, logoUrl, parentContestId, topN, reason). Response payloads are
// snake_case (ContestPartner/ChildContest/ContestPromotion json tags:
// contact_email, child_contest_id, rank_in_child, ...). There is NO casing
// transform anywhere in the pipeline (verified: this file's fetch -> plain
// JSON.stringify -> /api/admin-proxy/[...path]/route.ts, which forwards the
// request/response body as raw text, untouched, straight to the Go backend) —
// so the object literals below must spell each key exactly as the Go JSON tag
// does, by hand, same as every other service in this directory.

import { apiRoot } from '@/config/env';

function adminBase(): string {
  return `${apiRoot()}/api/connect/admin`;
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

export class ContestPromotionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ContestPromotionError';
    this.status = status;
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: authHeaders(), cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ContestPromotionError((body?.error as string) || `Request failed (${res.status})`, res.status);
  return (body?.data ?? body) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ContestPromotionError((json?.error as string) || `Request failed (${res.status})`, res.status);
  return (json?.data ?? json) as T;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ContestPromotionError((json?.error as string) || `Request failed (${res.status})`, res.status);
  return (json?.data ?? json) as T;
}

// ─── Partners (contest_partners) — response fields snake_case per ContestPartner ──

export interface ContestPartner {
  id: string;
  name: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  logo_url?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerInput {
  name: string;
  contactEmail?: string;
  contactPhone?: string;
  logoUrl?: string;
  notes?: string;
}

/** POST /contest-partners — CreatePartnerRequest body, camelCase per json tags. */
export async function createPartner(input: PartnerInput): Promise<ContestPartner> {
  return postJson<ContestPartner>('/contest-partners', {
    name: input.name,
    contactEmail: input.contactEmail || '',
    contactPhone: input.contactPhone || '',
    logoUrl: input.logoUrl || '',
    notes: input.notes || '',
  });
}

/** GET /contest-partners. */
export async function listPartners(): Promise<ContestPartner[]> {
  return getJson<ContestPartner[]>('/contest-partners');
}

/** PATCH /contest-partners/:id — all fields optional, only send what changed. */
export async function updatePartner(id: string, input: Partial<PartnerInput>): Promise<ContestPartner> {
  const body: Record<string, string> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.contactEmail !== undefined) body.contactEmail = input.contactEmail;
  if (input.contactPhone !== undefined) body.contactPhone = input.contactPhone;
  if (input.logoUrl !== undefined) body.logoUrl = input.logoUrl;
  if (input.notes !== undefined) body.notes = input.notes;
  return patchJson<ContestPartner>(`/contest-partners/${encodeURIComponent(id)}`, body);
}

// ─── Child contests ───────────────────────────────────────────────────────────

export interface ChildContest {
  id: string;
  name: string;
  status: string;
  state?: string | null;
  lga?: string | null;
  partner_id?: string | null;
}

/** GET /contests/:id/children — :id is the PARENT contest's real UUID (public.contests.id). */
export async function listChildContests(parentContestId: string): Promise<ChildContest[]> {
  return getJson<ChildContest[]>(`/contests/${encodeURIComponent(parentContestId)}/children`);
}

// ─── Promotions (contest_promotions) — response fields snake_case ────────────

export type PromotionStatus = 'pending' | 'approved' | 'rejected' | 'executed';

export interface ContestPromotion {
  id: string;
  child_contest_id: string;
  parent_contest_id: string;
  contestant_id: string;
  rank_in_child: number;
  requested_by: string;
  requested_at: string;
  approved_by?: string | null;
  approved_at?: string | null;
  status: PromotionStatus;
  new_contestant_id?: string | null;
  rejection_reason?: string | null;
}

/**
 * POST /contests/:id/request-promotion — :id is the CHILD contest's real
 * UUID. topN <= 0 (or omitted) falls back to the child's default_promote_top_n.
 * Returns one ContestPromotion row per promoted contestant.
 */
export async function requestPromotion(childContestId: string, parentContestId: string, topN?: number): Promise<ContestPromotion[]> {
  return postJson<ContestPromotion[]>(`/contests/${encodeURIComponent(childContestId)}/request-promotion`, {
    parentContestId,
    topN: topN && topN > 0 ? topN : 0,
  });
}

/** GET /contest-promotions?status=pending — status optional. */
export async function listPromotions(status?: PromotionStatus): Promise<ContestPromotion[]> {
  return getJson<ContestPromotion[]>(`/contest-promotions${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}

/** GET /contest-promotions/:id. */
export async function getPromotion(id: string): Promise<ContestPromotion> {
  return getJson<ContestPromotion>(`/contest-promotions/${encodeURIComponent(id)}`);
}

/**
 * POST /contest-promotions/:id/approve. Maker-checker: the backend 403s
 * (ErrPromotionSelfApproval) when the caller is the same admin who requested
 * it. Per this codebase's established convention (app/admin/voting/approvals
 * and app/admin/payments-finance/adjustments — both document this explicitly
 * and neither hides/disables the button client-side, since there is no
 * "current admin id" accessor anywhere in the admin console to compare
 * against), callers of this function should submit normally and surface a
 * thrown ContestPromotionError with status 403 as-is rather than trying to
 * predict self-approval in the UI.
 */
export async function approvePromotion(id: string): Promise<ContestPromotion> {
  return postJson<ContestPromotion>(`/contest-promotions/${encodeURIComponent(id)}/approve`, {});
}

/** POST /contest-promotions/:id/reject — reason required (RejectPromotionRequest.Reason `binding:"required"`). */
export async function rejectPromotion(id: string, reason: string): Promise<ContestPromotion> {
  return postJson<ContestPromotion>(`/contest-promotions/${encodeURIComponent(id)}/reject`, { reason });
}
