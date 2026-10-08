// Pure rules mirroring the Go backend's role-profile validation. No React and
// no '@/' imports so the node test runner can load this file directly.

export type ProfessionalRole = 'estate_manager' | 'developer' | 'agent';

export const PROFESSIONAL_ROLES: ProfessionalRole[] = ['estate_manager', 'developer', 'agent'];

const REQUIRED: Record<ProfessionalRole, readonly string[]> = {
  agent: ['licenceNumber', 'operatingStates'],
  developer: ['companyName', 'cacNumber'],
  estate_manager: ['organisationName'],
};

const OPTIONAL: Record<ProfessionalRole, readonly string[]> = {
  agent: ['agencyName', 'bio', 'specialisations'],
  developer: ['website', 'projectSummary'],
  estate_manager: ['estatesManaged'],
};

export function requiredFieldsFor(role: ProfessionalRole): string[] {
  return [...REQUIRED[role]];
}

export function optionalFieldsFor(role: ProfessionalRole): string[] {
  return [...OPTIONAL[role]];
}

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function missingRequired(role: ProfessionalRole, details: Record<string, unknown>): string[] {
  return REQUIRED[role].filter((k) => isBlank(details[k]));
}

export type DetailKind = 'string' | 'stringList' | 'count';

// Mirrors backend/internal/property/roles/validate.go key types exactly.
const KINDS: Record<ProfessionalRole, Record<string, DetailKind>> = {
  agent: { licenceNumber: 'string', agencyName: 'string', bio: 'string', specialisations: 'string', operatingStates: 'stringList' },
  developer: { companyName: 'string', cacNumber: 'string', website: 'string', projectSummary: 'string' },
  estate_manager: { organisationName: 'string', estatesManaged: 'count' },
};

export function detailKindFor(role: ProfessionalRole, key: string): DetailKind | undefined {
  return KINDS[role][key];
}

// Keys whose edit resets verification on a verified/pending profile
// (validate.go identityKeys). displayName is not identity-bearing.
const IDENTITY: Record<ProfessionalRole, readonly string[]> = {
  agent: ['licenceNumber'],
  developer: ['cacNumber', 'companyName'],
  estate_manager: ['organisationName'],
};

export function identityKeysFor(role: ProfessionalRole): string[] {
  return [...IDENTITY[role]];
}

/** Identity keys whose value differs between the saved and the edited details. */
export function identityChangedKeys(
  role: ProfessionalRole,
  saved: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  return IDENTITY[role].filter((k) => JSON.stringify(saved[k]) !== JSON.stringify(next[k]));
}

/**
 * Build the PATCH `details` body. The server MERGES details over the stored
 * ones and treats null as "delete this key". So: changed values are sent,
 * unchanged values are omitted, a previously-saved optional key that is now
 * blank is sent as null, and a never-saved blank optional key is omitted.
 * Required keys are never nulled (blank required blocks Save/Submit instead).
 */
export function buildDetailsPatch(
  role: ProfessionalRole,
  saved: Record<string, unknown>,
  form: Record<string, unknown>,
): Record<string, unknown> {
  const required = REQUIRED[role];
  const out: Record<string, unknown> = {};
  for (const k of [...REQUIRED[role], ...OPTIONAL[role]]) {
    const next = form[k];
    const prev = saved[k];
    if (isBlank(next)) {
      if (!required.includes(k) && !isBlank(prev)) out[k] = null;
      continue;
    }
    if (JSON.stringify(next) !== JSON.stringify(prev)) out[k] = next;
  }
  return out;
}
