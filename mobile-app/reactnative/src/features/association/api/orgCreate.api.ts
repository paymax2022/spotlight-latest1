// ── Association — Organisation publish API (U) ────────────────────────────────

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK, ASSOCIATION_API_BASE as BASE } from '../constants/association.constants';
import type { OrgDraft, PublishResult } from '../types/orgDraft.types';

// Every write below has a real live endpoint (verified against
// backend/internal/association/routes.go and a full green run of
// backend/tests/association), so fixture mode has nothing to add and refuses
// loudly instead of reporting a write it did not perform — mirrors
// frontend-admin's crowdfundingAdminService.ts NOT_IN_FIXTURE_MODE pattern.
const notInFixtureMode = (action: string) =>
  new Error(`${action} is unavailable in fixture mode: this app will not report a write it did not perform. Set EXPO_PUBLIC_ASSOCIATION_USE_MOCK=false to send this against the live backend.`);

export async function publishOrganisation(draft: OrgDraft): Promise<PublishResult> {
  if (USE_MOCK) throw notInFixtureMode('Publishing an organisation');
  // foundedYear is collected as text so the input can be partially typed; the
  // server's OrgDraft takes a nullable int, where null means "not supplied" and
  // is refused. Sending the raw string would fail JSON binding outright, and
  // sending Number('') would send 0 — a value that looks supplied and then
  // fails the range check with a confusing message.
  const year = draft.foundedYear.trim();
  const payload = {
    ...draft,
    foundedYear: /^\d{4}$/.test(year) ? Number(year) : null,
  };
  const { data } = await api.post(`${BASE}`, payload, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}
