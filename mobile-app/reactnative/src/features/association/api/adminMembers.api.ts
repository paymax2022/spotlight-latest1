// ── Association — Admin RBAC & member actions API (Q depth) ───────────────────

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK } from '../constants/association.constants';
import type { AdminAccess, AdminRole, MemberActionResult } from '../types/adminRole.types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

// Mock: the signed-in user is a Lagos chapter admin.
const MOCK_ACCESS: AdminAccess = {
  isAdmin: true,
  role: 'CHAPTER_ADMIN',
  roleLabel: 'Chapter admin',
  jurisdiction: 'CHAPTER',
  can: { approveMembers: true, manageMembers: true, manageFinance: true, importMembers: true },
};

export async function getMyAdminAccess(): Promise<AdminAccess> {
  if (USE_MOCK) { await delay(); return MOCK_ACCESS; }
  const { data } = await api.get('/associations/me/admin-access');
  return data;
}

export async function suspendMember(id: string, reason: string): Promise<MemberActionResult> {
  if (USE_MOCK) { await delay(350); return { ok: true }; }
  const { data } = await api.post(`/associations/admin/members/${id}/suspend`, { reason }, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

export async function restoreMember(id: string): Promise<MemberActionResult> {
  if (USE_MOCK) { await delay(350); return { ok: true }; }
  const { data } = await api.post(`/associations/admin/members/${id}/restore`, {}, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

export async function transferMember(id: string, chapter: string): Promise<MemberActionResult> {
  if (USE_MOCK) { await delay(350); return { ok: true }; }
  const { data } = await api.post(`/associations/admin/members/${id}/transfer`, { chapter }, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

export async function assignRole(id: string, role: AdminRole): Promise<MemberActionResult> {
  if (USE_MOCK) { await delay(350); return { ok: true }; }
  const { data } = await api.post(`/associations/admin/members/${id}/role`, { role }, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}
