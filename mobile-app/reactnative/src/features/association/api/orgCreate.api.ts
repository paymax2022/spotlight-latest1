// ── Association — Organisation publish API (U) ────────────────────────────────

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK, ASSOCIATION_API_BASE as BASE } from '../constants/association.constants';
import { addCreatedOrganisation, draftToOrganisation } from './association.createdStore';
import type { OrgDraft, PublishResult } from '../types/orgDraft.types';

const delay = (ms = 600) => new Promise((r) => setTimeout(r, ms));

export async function publishOrganisation(draft: OrgDraft): Promise<PublishResult> {
  if (USE_MOCK) {
    await delay();
    const organisationId = `org_${Date.now()}`;
    // Persist to the session store so the detail/discovery screens can load it.
    addCreatedOrganisation(draftToOrganisation(draft, organisationId));
    return { organisationId, name: draft.name };
  }
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
