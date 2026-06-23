// ── Association — Organisation publish API (U) ────────────────────────────────

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK } from '../constants/association.constants';
import type { OrgDraft, PublishResult } from '../types/orgDraft.types';

const delay = (ms = 600) => new Promise((r) => setTimeout(r, ms));

export async function publishOrganisation(draft: OrgDraft): Promise<PublishResult> {
  if (USE_MOCK) {
    await delay();
    return { organisationId: `org_${Date.now()}`, name: draft.name };
  }
  const { data } = await api.post('/associations', draft, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}
