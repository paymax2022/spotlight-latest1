import { env } from '@/config/env';
import type {
  OnboardingApplication,
  OnboardingQueueRow,
  OnboardingQueueFilters,
} from '@/types/onboarding';
import {
  onboardingQueueFixture,
  onboardingApplicationFixture,
} from '@/services/onboardingFixtures';

// Backend admin onboarding routes live under the /admin prefix on the Go API,
// matching usersService: env.apiBaseUrl ends with /api/v1 and admin routes
// hang off /api/admin/...
function adminApiBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api');
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// Toggle to true to render against fixtures while the live API is being wired.
// When the backend endpoints are deployed, set USE_FIXTURES = false (or remove).
// Mock by default; flip with NEXT_PUBLIC_ONBOARDING_ADMIN_USE_MOCK=false once the
// live Go admin endpoints (/api/admin/onboarding/*) are deployed. Matches the
// fx/mobility/realtor/invest admin-service convention.
const USE_FIXTURES = (process.env.NEXT_PUBLIC_ONBOARDING_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function toQuery(filters: OnboardingQueueFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters || {})) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (!s) continue;
    params.set(k, s);
  }
  return params.toString();
}

// GET /admin/onboarding/review-queue?module=&type=&status=&age=
export async function listReviewQueue(
  filters: OnboardingQueueFilters,
): Promise<OnboardingQueueRow[]> {
  if (USE_FIXTURES) {
    return filterFixtureQueue(onboardingQueueFixture, filters);
  }
  const qs = toQuery(filters);
  const res = await fetch(
    `${adminApiBase()}/admin/onboarding/review-queue${qs ? `?${qs}` : ''}`,
    { cache: 'no-store', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Review queue list failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  // Accept either {applications:[...]} or a bare array.
  if (Array.isArray(data)) return data as OnboardingQueueRow[];
  return (data.applications ?? data.data ?? []) as OnboardingQueueRow[];
}

// GET /admin/onboarding/applications/:id
export async function getApplication(id: string): Promise<OnboardingApplication> {
  if (USE_FIXTURES) {
    return onboardingApplicationFixture(id);
  }
  const res = await fetch(
    `${adminApiBase()}/admin/onboarding/applications/${encodeURIComponent(id)}`,
    { cache: 'no-store', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`Application fetch failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (data.application ?? data) as OnboardingApplication;
}

async function postAction(
  id: string,
  action: 'approve' | 'reject' | 'request-info' | 'escalate',
  body: Record<string, unknown> = {},
): Promise<OnboardingApplication> {
  if (USE_FIXTURES) {
    // Simulate latency + an updated application echoing the decision.
    await new Promise((r) => setTimeout(r, 350));
    const app = await onboardingApplicationFixture(id);
    const nextStatus =
      action === 'approve'
        ? 'APPROVED'
        : action === 'reject'
          ? 'REJECTED'
          : action === 'request-info'
            ? 'NEEDS_MORE_INFO'
            : 'UNDER_REVIEW';
    return {
      ...app,
      status: nextStatus,
      decisionReason: (body.reason as string) ?? app.decisionReason,
      infoChecklist: (body.checklist as string[]) ?? app.infoChecklist,
      decidedAt:
        action === 'approve' || action === 'reject'
          ? new Date().toISOString()
          : app.decidedAt,
      updatedAt: new Date().toISOString(),
    };
  }
  const res = await fetch(
    `${adminApiBase()}/admin/onboarding/applications/${encodeURIComponent(id)}/${action}`,
    { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`Onboarding ${action} failed: ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return (data.application ?? data) as OnboardingApplication;
}

// POST /admin/onboarding/applications/:id/approve
export function approveApplication(id: string): Promise<OnboardingApplication> {
  return postAction(id, 'approve');
}

// POST /admin/onboarding/applications/:id/reject {reason}
export function rejectApplication(
  id: string,
  reason: string,
): Promise<OnboardingApplication> {
  return postAction(id, 'reject', { reason });
}

// POST /admin/onboarding/applications/:id/request-info {checklist:[...]}
export function requestMoreInfo(
  id: string,
  checklist: string[],
): Promise<OnboardingApplication> {
  return postAction(id, 'request-info', { checklist });
}

// POST /admin/onboarding/applications/:id/escalate
export function escalateApplication(id: string): Promise<OnboardingApplication> {
  return postAction(id, 'escalate');
}

// Helpers ------------------------------------------------------------------

export function ageFromNow(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// SLA: applications older than 3 days breach review SLA.
export function slaBreached(iso: string | null): boolean {
  if (!iso) return false;
  const ms = Date.now() - new Date(iso).getTime();
  return ms > 3 * 24 * 60 * 60 * 1000;
}

function ageBucketMs(age: string): number {
  switch (age) {
    case '1d':
      return 24 * 60 * 60 * 1000;
    case '3d':
      return 3 * 24 * 60 * 60 * 1000;
    case '7d':
      return 7 * 24 * 60 * 60 * 1000;
    default:
      return 0;
  }
}

function filterFixtureQueue(
  rows: OnboardingQueueRow[],
  filters: OnboardingQueueFilters,
): OnboardingQueueRow[] {
  return rows.filter((r) => {
    if (filters.module && r.moduleId !== filters.module) return false;
    if (filters.type && r.merchantTypeId !== filters.type) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.age) {
      const limit = ageBucketMs(filters.age);
      const ref = r.submittedAt ?? r.createdAt;
      if (limit && Date.now() - new Date(ref).getTime() < limit) return false;
    }
    return true;
  });
}
