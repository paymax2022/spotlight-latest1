
import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK, ASSOCIATION_API_BASE as BASE } from '../constants';
import { withOrgScope } from './adminScope';
import type {
  AdminKpis, AdminApplication, AdminApplicationSummary, AdminOrgOption, ApplicationJurisdiction, ApprovalDecision,
  FinanceSummary, OfflinePayment, ImportPreview, ImportResult, AuditEntry,
} from '../types';
import {
  MOCK_KPIS, MOCK_APPLICATIONS, MOCK_FINANCE, MOCK_OFFLINE_PAYMENTS, MOCK_IMPORT_PREVIEW, MOCK_AUDIT,
} from './mocks';
import { MOCK_ORGANISATIONS } from './association.mock';
import type { PickedFile } from '../utils';

const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));

// Every write below has a real live endpoint (verified against
// backend/internal/association/routes.go and a full green run of
// backend/tests/association), so fixture mode has nothing to add and refuses
// loudly instead of reporting a write it did not perform — mirrors
// frontend-admin's crowdfundingAdminService.ts NOT_IN_FIXTURE_MODE pattern.
const notInFixtureMode = (action: string) =>
  new Error(`${action} is unavailable in fixture mode: this app will not report a write it did not perform. Set EXPO_PUBLIC_ASSOCIATION_USE_MOCK=false to send this against the live backend.`);

const toAppSummary = (a: AdminApplication): AdminApplicationSummary => {
  const { id, applicantName, category, chapter, submittedAt, status, jurisdiction, paid } = a;
  return { id, applicantName, category, chapter, submittedAt, status, jurisdiction, paid };
};

export async function getAdminKpis(orgId?: string | null): Promise<AdminKpis> {
  if (USE_MOCK) { await delay(); return MOCK_KPIS; }
  const { data } = await api.get(`${BASE}/admin/kpis`, { params: withOrgScope({}, orgId) });
  return data;
}

export async function getApprovalQueue(
  jurisdiction: ApplicationJurisdiction | 'ALL' = 'ALL',
  orgId?: string | null,
): Promise<AdminApplicationSummary[]> {
  if (USE_MOCK) {
    await delay();
    const list = MOCK_APPLICATIONS.map(toAppSummary);
    return jurisdiction === 'ALL' ? list : list.filter((a) => a.jurisdiction === jurisdiction);
  }
  const { data } = await api.get(`${BASE}/admin/approvals`, { params: withOrgScope({ jurisdiction }, orgId) });
  return data;
}

export async function getApplication(id: string): Promise<AdminApplication> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_APPLICATIONS.find((a) => a.id === id);
    if (!found) throw new Error('Application not found');
    return found;
  }
  const { data } = await api.get(`${BASE}/admin/approvals/${id}`);
  return data;
}

export async function decideApplication(id: string, decision: ApprovalDecision, note?: string): Promise<{ ok: true }> {
  if (USE_MOCK) throw notInFixtureMode('Deciding an application');
  const { data } = await api.post(
    `${BASE}/admin/approvals/${id}/decision`,
    { decision, note },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  return data;
}

export async function getFinanceSummary(orgId?: string | null): Promise<FinanceSummary> {
  if (USE_MOCK) { await delay(); return MOCK_FINANCE; }
  const { data } = await api.get(`${BASE}/admin/finance`, { params: withOrgScope({}, orgId) });
  return data;
}

export async function getOfflinePayments(orgId?: string | null): Promise<OfflinePayment[]> {
  if (USE_MOCK) { await delay(); return MOCK_OFFLINE_PAYMENTS.filter((p) => p.status === 'PENDING'); }
  const { data } = await api.get(`${BASE}/admin/finance/offline`, { params: withOrgScope({}, orgId) });
  return data;
}

export async function decideOfflinePayment(id: string, approve: boolean): Promise<{ ok: true }> {
  if (USE_MOCK) throw notInFixtureMode('Deciding an offline payment');
  const { data } = await api.post(
    `${BASE}/admin/finance/offline/${id}/decision`,
    { approve },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  return data;
}

export async function getAuditLog(action?: string, orgId?: string | null): Promise<AuditEntry[]> {
  if (USE_MOCK) {
    await delay();
    return action && action !== 'all' ? MOCK_AUDIT.filter((a) => a.action === action) : MOCK_AUDIT;
  }
  const { data } = await api.get(`${BASE}/admin/audit-log`, { params: withOrgScope({ action }, orgId) });
  return data;
}

/**
 * The console's organisation picker feed.
 *
 * One endpoint serves both audiences: a platform super-admin gets every
 * organisation, a per-org officer only the ones they hold a real admin role in.
 * The super-admin needs it because `GET /me/admin-access` reports their
 * `organisationId` as null — they are not scoped to one org — so every org-scoped
 * admin read has no organisation to report on until they choose one.
 */
export async function getAdminOrganisations(search?: string): Promise<AdminOrgOption[]> {
  if (USE_MOCK) {
    await delay();
    // Fixture mode has no admin-role table to scope against, so it lists the same
    // demo organisations the member-facing browse shows.
    const list: AdminOrgOption[] = MOCK_ORGANISATIONS.map((o) => ({
      id: o.id,
      name: o.name,
      acronym: o.acronym ?? null,
      category: o.category,
      status: 'ACTIVE',
      published: true,
      verified: o.verified,
      memberCount: o.memberCount,
      createdAt: '',
    }));
    if (!search?.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter(
      (o) => o.name.toLowerCase().includes(q) || (o.acronym ?? '').toLowerCase().includes(q) || o.category.toLowerCase().includes(q),
    );
  }
  const { data } = await api.get(`${BASE}/admin/organisations`, { params: { search } });
  return data;
}

/**
 * Upload the member spreadsheet and get the server's dry-run preview.
 *
 * `POST /admin/import/preview` is a multipart endpoint expecting a `file` part
 * and an `org_id` query param. The previous implementation posted an empty JSON
 * body, which the handler rejected with a guaranteed HTTP 400 — the screen's
 * "Upload file" button could never succeed.
 *
 * Multipart is built the same way as the crowdfunding cover upload: the DOM
 * FormData needs a real Blob on web, while RN's FormData streams a
 * `{ uri, name, type }` descriptor on native.
 */
export async function getImportPreview(file: PickedFile, orgId?: string): Promise<ImportPreview> {
  if (USE_MOCK) { await delay(500); return { ...MOCK_IMPORT_PREVIEW, fileName: file?.name ?? MOCK_IMPORT_PREVIEW.fileName }; }
  if (!file?.uri) throw new Error('No file selected');

  const type = file.mimeType ?? 'application/octet-stream';
  const form = new FormData();
  if (file.uri.startsWith('blob:') || file.uri.startsWith('data:')) {
    const blob = await (await fetch(file.uri)).blob();
    form.append('file', new File([blob], file.name, { type: blob.type || type }));
  } else {
    form.append('file', { uri: file.uri, name: file.name, type } as unknown as Blob);
  }

  const { data } = await api.post(`${BASE}/admin/import/preview`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    params: orgId ? { org_id: orgId } : undefined,
  });
  return data;
}

export async function confirmImport(sendInvites: boolean): Promise<ImportResult> {
  if (USE_MOCK) throw notInFixtureMode('Confirming a member import');
  const { data } = await api.post(
    `${BASE}/admin/import/confirm`,
    { sendInvites },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  return data;
}
