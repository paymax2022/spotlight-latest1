// ── Association — Admin-lite API wrapper (Q/R/S/T) ────────────────────────────

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK } from '../constants/association.constants';
import type {
  AdminKpis, AdminApplication, AdminApplicationSummary, ApplicationJurisdiction, ApprovalDecision,
  FinanceSummary, OfflinePayment, ImportPreview, ImportResult, AuditEntry,
} from '../types/admin.types';
import {
  MOCK_KPIS, MOCK_APPLICATIONS, MOCK_FINANCE, MOCK_OFFLINE_PAYMENTS, MOCK_IMPORT_PREVIEW, MOCK_AUDIT,
} from './admin.mock';

const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));

const toAppSummary = (a: AdminApplication): AdminApplicationSummary => {
  const { id, applicantName, category, chapter, submittedAt, status, jurisdiction, paid } = a;
  return { id, applicantName, category, chapter, submittedAt, status, jurisdiction, paid };
};

export async function getAdminKpis(): Promise<AdminKpis> {
  if (USE_MOCK) { await delay(); return MOCK_KPIS; }
  const { data } = await api.get('/associations/admin/kpis');
  return data;
}

export async function getApprovalQueue(jurisdiction: ApplicationJurisdiction | 'ALL' = 'ALL'): Promise<AdminApplicationSummary[]> {
  if (USE_MOCK) {
    await delay();
    const list = MOCK_APPLICATIONS.map(toAppSummary);
    return jurisdiction === 'ALL' ? list : list.filter((a) => a.jurisdiction === jurisdiction);
  }
  const { data } = await api.get('/associations/admin/approvals', { params: { jurisdiction } });
  return data;
}

export async function getApplication(id: string): Promise<AdminApplication> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_APPLICATIONS.find((a) => a.id === id);
    if (!found) throw new Error('Application not found');
    return found;
  }
  const { data } = await api.get(`/associations/admin/approvals/${id}`);
  return data;
}

export async function decideApplication(id: string, decision: ApprovalDecision, note?: string): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(400); return { ok: true }; }
  const { data } = await api.post(
    `/associations/admin/approvals/${id}/decision`,
    { decision, note },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  return data;
}

// ─── Finance ──────────────────────────────────────────────────────────────────

export async function getFinanceSummary(): Promise<FinanceSummary> {
  if (USE_MOCK) { await delay(); return MOCK_FINANCE; }
  const { data } = await api.get('/associations/admin/finance');
  return data;
}

export async function getOfflinePayments(): Promise<OfflinePayment[]> {
  if (USE_MOCK) { await delay(); return MOCK_OFFLINE_PAYMENTS.filter((p) => p.status === 'PENDING'); }
  const { data } = await api.get('/associations/admin/finance/offline');
  return data;
}

export async function decideOfflinePayment(id: string, approve: boolean): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(350); return { ok: true }; }
  const { data } = await api.post(
    `/associations/admin/finance/offline/${id}/decision`,
    { approve },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  return data;
}

// ─── Audit log ────────────────────────────────────────────────────────────────

export async function getAuditLog(action?: string): Promise<AuditEntry[]> {
  if (USE_MOCK) {
    await delay();
    return action && action !== 'all' ? MOCK_AUDIT.filter((a) => a.action === action) : MOCK_AUDIT;
  }
  const { data } = await api.get('/associations/admin/audit-log', { params: { action } });
  return data;
}

// ─── Bulk import ──────────────────────────────────────────────────────────────

export async function getImportPreview(): Promise<ImportPreview> {
  if (USE_MOCK) { await delay(500); return MOCK_IMPORT_PREVIEW; }
  const { data } = await api.post('/associations/admin/import/preview', {});
  return data;
}

export async function confirmImport(sendInvites: boolean): Promise<ImportResult> {
  if (USE_MOCK) {
    await delay(600);
    const p = MOCK_IMPORT_PREVIEW;
    return { imported: p.valid, skipped: p.duplicates + p.invalid, invited: sendInvites ? p.valid : 0, batchId: `batch_${Date.now()}` };
  }
  const { data } = await api.post(
    '/associations/admin/import/confirm',
    { sendInvites },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  return data;
}
