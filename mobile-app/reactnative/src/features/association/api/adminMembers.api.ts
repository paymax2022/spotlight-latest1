// ── Association — Admin RBAC & member actions API (Q depth) ───────────────────

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK, ASSOCIATION_API_BASE as BASE } from '../constants/association.constants';
import type { AdminAccess, AdminRole, MemberActionResult } from '../types/adminRole.types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

// Every write below has a real live endpoint (verified against
// backend/internal/association/routes.go and a full green run of
// backend/tests/association), so fixture mode has nothing to add and refuses
// loudly instead of reporting a write it did not perform — mirrors
// frontend-admin's crowdfundingAdminService.ts NOT_IN_FIXTURE_MODE pattern.
const notInFixtureMode = (action: string) =>
  new Error(`${action} is unavailable in fixture mode: this app will not report a write it did not perform. Set EXPO_PUBLIC_ASSOCIATION_USE_MOCK=false to send this against the live backend.`);

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
  const { data } = await api.get(`${BASE}/me/admin-access`);
  return data;
}

export async function suspendMember(id: string, reason: string): Promise<MemberActionResult> {
  if (USE_MOCK) throw notInFixtureMode('Suspending a member');
  const { data } = await api.post(`${BASE}/admin/members/${id}/suspend`, { reason }, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

export async function restoreMember(id: string): Promise<MemberActionResult> {
  if (USE_MOCK) throw notInFixtureMode('Restoring a member');
  const { data } = await api.post(`${BASE}/admin/members/${id}/restore`, {}, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

export async function transferMember(id: string, chapter: string): Promise<MemberActionResult> {
  if (USE_MOCK) throw notInFixtureMode('Transferring a member');
  const { data } = await api.post(`${BASE}/admin/members/${id}/transfer`, { chapter }, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

export async function assignRole(id: string, role: AdminRole): Promise<MemberActionResult> {
  if (USE_MOCK) throw notInFixtureMode('Assigning an admin role');
  const { data } = await api.post(`${BASE}/admin/members/${id}/role`, { role }, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}
