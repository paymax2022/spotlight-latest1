'use client';

import { authFetch, isUnauthorized, redirectToLogin } from '@/src/lib/auth/flow';
import type {
  CampaignCategory,
  CampaignComment,
  CampaignDetail,
  CampaignMilestone,
  CampaignSummary,
  Contribution,
  Contributor,
  RawContribution,
  SubmitCampaignRequest,
  SubmitCampaignResult,
  UploadResult,
} from '@/src/types/crowdfunding-customer';

export class CrowdfundingApiError extends Error {}

function buildIdempotencyKey(scope: string, seed: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `CF-${scope}-${Date.now()}-${seed.replace(/\W/g, '').slice(-6)}-${random}`;
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({}));
}

// Most crowdfunding reads/writes wrap their payload in `{ data: ... }`.
async function parseEnvelope<T>(response: Response, redirectPath: string): Promise<T | null> {
  if (isUnauthorized(response)) { redirectToLogin(redirectPath); return null; }
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new CrowdfundingApiError(String(payload?.error || 'Crowdfunding request failed.'));
  }
  return (payload?.data ?? null) as T;
}

// A few routes (contribute, save/unsave, single-contribution read,
// refund-request) return the object bare, with no `data` wrapper.
async function parseBare<T>(response: Response, redirectPath: string): Promise<T | null> {
  if (isUnauthorized(response)) { redirectToLogin(redirectPath); return null; }
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new CrowdfundingApiError(String(payload?.error || 'Crowdfunding request failed.'));
  }
  return payload as T;
}

export interface CampaignQuery {
  collection?: 'featured' | 'trending' | 'urgent' | 'verified' | 'recommended' | 'recent';
  category?: string;
  type?: string;
  verifiedOnly?: boolean;
  urgentOnly?: boolean;
  search?: string;
  sort?: 'recommended' | 'trending' | 'newest' | 'ending_soon' | 'most_funded' | 'least_funded';
}

export async function listCategories(): Promise<CampaignCategory[]> {
  const response = await authFetch('/api/v1/crowdfunding/categories', { cache: 'no-store' });
  return (await parseEnvelope<CampaignCategory[]>(response, '/crowdfunding')) ?? [];
}

export async function listCampaigns(query: CampaignQuery): Promise<CampaignSummary[]> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  const response = await authFetch(`/api/v1/crowdfunding/campaigns${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  return (await parseEnvelope<CampaignSummary[]>(response, '/crowdfunding')) ?? [];
}

export async function getCampaign(id: string): Promise<CampaignDetail | null> {
  const response = await authFetch(`/api/v1/crowdfunding/campaigns/${id}`, { cache: 'no-store' });
  return parseEnvelope<CampaignDetail>(response, `/crowdfunding/${id}`);
}

export async function getContributors(id: string): Promise<Contributor[]> {
  const response = await authFetch(`/api/v1/crowdfunding/campaigns/${id}/contributors`, { cache: 'no-store' });
  return (await parseEnvelope<Contributor[]>(response, `/crowdfunding/${id}`)) ?? [];
}

export async function getMilestones(id: string): Promise<CampaignMilestone[]> {
  const response = await authFetch(`/api/v1/crowdfunding/campaigns/${id}/milestones`, { cache: 'no-store' });
  return (await parseEnvelope<CampaignMilestone[]>(response, `/crowdfunding/${id}`)) ?? [];
}

export async function getComments(id: string): Promise<CampaignComment[]> {
  const response = await authFetch(`/api/v1/crowdfunding/campaigns/${id}/comments`, { cache: 'no-store' });
  return (await parseEnvelope<CampaignComment[]>(response, `/crowdfunding/${id}`)) ?? [];
}

export async function postComment(id: string, body: string, isQuestion: boolean): Promise<CampaignComment | null> {
  const response = await authFetch(`/api/v1/crowdfunding/campaigns/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, isQuestion }),
  }, { json: true });
  return parseEnvelope<CampaignComment>(response, `/crowdfunding/${id}`);
}

export async function reportComment(commentId: string): Promise<void> {
  const response = await authFetch(`/api/v1/crowdfunding/comments/${commentId}/report`, { method: 'POST' });
  await parseEnvelope<{ reported: boolean }>(response, '/crowdfunding');
}

export async function toggleSave(id: string, saved: boolean): Promise<{ id: string; saved: boolean } | null> {
  const response = await authFetch(`/api/v1/crowdfunding/campaigns/${id}/save`, { method: saved ? 'DELETE' : 'POST' });
  return parseBare<{ id: string; saved: boolean }>(response, `/crowdfunding/${id}`);
}

export async function contribute(id: string, amountKobo: number): Promise<RawContribution | null> {
  const idempotencyKey = buildIdempotencyKey('donate', id);
  const response = await authFetch(`/api/v1/crowdfunding/campaigns/${id}/contribute`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ amount_kobo: amountKobo, idempotency_key: idempotencyKey }),
  }, { json: true });
  return parseBare<RawContribution>(response, `/crowdfunding/${id}`);
}

export async function listContributions(status?: string): Promise<Contribution[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await authFetch(`/api/v1/crowdfunding/contributions${qs}`, { cache: 'no-store' });
  return (await parseEnvelope<Contribution[]>(response, '/crowdfunding/contributions')) ?? [];
}

export async function getContribution(id: string): Promise<Contribution | null> {
  const response = await authFetch(`/api/v1/crowdfunding/contributions/${id}`, { cache: 'no-store' });
  return parseBare<Contribution>(response, `/crowdfunding/contributions/${id}`);
}

export async function requestRefund(id: string, reason?: string): Promise<{ status: string } | null> {
  const response = await authFetch(`/api/v1/crowdfunding/contributions/${id}/refund-request`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }, { json: true });
  return parseBare<{ status: string }>(response, `/crowdfunding/contributions/${id}`);
}

export async function submitCampaign(body: SubmitCampaignRequest): Promise<SubmitCampaignResult | null> {
  const response = await authFetch('/api/v1/crowdfunding/campaigns', {
    method: 'POST',
    body: JSON.stringify(body),
  }, { json: true });
  return parseEnvelope<SubmitCampaignResult>(response, '/crowdfunding/create');
}

export async function uploadCampaignImage(file: File): Promise<UploadResult | null> {
  const form = new FormData();
  form.append('file', file);
  const response = await authFetch('/api/crowdfunding/uploads', { method: 'POST', body: form });
  if (isUnauthorized(response)) { redirectToLogin('/crowdfunding/create'); return null; }
  const payload = await parseJson(response);
  if (!response.ok || payload?.success === false) {
    throw new CrowdfundingApiError(String(payload?.error || 'Unable to upload image.'));
  }
  return (payload?.upload ?? null) as UploadResult | null;
}
