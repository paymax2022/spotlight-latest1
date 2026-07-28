// ── Association — created-org runtime store (mock mode) ───────────────────────
// In mock mode the create wizard's publish returns a fresh id but has no backend
// to persist to. This in-memory store holds orgs created this session so the
// organisation detail + discovery list can find them immediately after creation.
// (No-op once USE_MOCK is false — the real /associations endpoints own storage.)

import type { OrgDraft } from '../types/orgDraft.types';
import type { Organisation } from '../types/association.types';

const created: Organisation[] = [];

/** Human-readable approval path shown on the detail screen. */
function approvalSummary(draft: OrgDraft): string {
  switch (draft.approvalRule) {
    case 'AUTO':
      return 'Members are active immediately — no review required.';
    case 'ADMIN':
      return 'An admin reviews each application before activation.';
    case 'CHAPTER_THEN_NATIONAL':
      return 'Your chapter admin approves, then national validates.';
    case 'PAYMENT_FIRST':
      return 'Membership activates once the registration fee is confirmed.';
    default:
      return draft.groupType === 'OPEN'
        ? 'Open group — anyone can join instantly.'
        : 'Membership requires admin approval.';
  }
}

/** Build a full Organisation from the wizard draft + the issued id. */
export function draftToOrganisation(draft: OrgDraft, id: string): Organisation {
  const requiresPayment = (draft.registrationFeeKobo ?? 0) > 0 || draft.groupType === 'PAID';
  return {
    id,
    name: draft.name,
    acronym: draft.acronym || null,
    category: draft.category || 'Organisation',
    logoUrl: draft.logoUri ?? null,
    coverUrl: null,
    groupType: draft.groupType ?? 'CLOSED',
    memberCount: 0,
    chapterCount: draft.chapters.length,
    verified: false,
    location: null,
    tagline: null,
    description: draft.description || '',
    foundedYear: null,
    requiresPayment,
    registrationFeeKobo: draft.registrationFeeKobo ?? 0,
    approvalSummary: approvalSummary(draft),
    membershipCategories: draft.categories.map((c) => ({
      id: c.id,
      label: c.label,
      description: null,
      duesKobo: c.duesKobo,
      duesCadence: c.cadence,
    })),
    chapters: draft.chapters.map((ch) => ({
      id: ch.id,
      name: ch.name,
      level: ch.level,
      parentId: null,
      memberCount: 0,
    })),
    requirements: [],
    rules: draft.rules,
    website: null,
    branches: [],
    committeeOptions: draft.committees.map((cm) => cm.name),
  };
}

/** Add a created org to the front of the runtime store. */
export function addCreatedOrganisation(org: Organisation): void {
  const i = created.findIndex((o) => o.id === org.id);
  if (i >= 0) created[i] = org;
  else created.unshift(org);
}

/** Look up a created org by id (used by getOrganisation in mock mode). */
export function getCreatedOrganisation(id: string): Organisation | undefined {
  return created.find((o) => o.id === id);
}

/** All orgs created this session (used by getOrganisations in mock mode). */
export function listCreatedOrganisations(): Organisation[] {
  return created;
}
