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
