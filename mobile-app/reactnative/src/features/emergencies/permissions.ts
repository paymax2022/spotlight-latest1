// Who may resolve an emergency alert. Product decision (2026-10-15): only the
// estate manager (estate_residents.role = 'estate_admin'). The server enforces
// it in frontend-web .../estate/emergencies/[id]/resolve; this only decides
// whether to show the action. The role comes from the property context
// (/api/finance/property/context), the same source the Property hub uses.
import type { ContextEnvelope } from '@/features/property/types';

/** Fails closed: no context (still loading, module off, error) → no Resolve. */
export function canResolveEmergency(envelope: ContextEnvelope | null | undefined): boolean {
  return !!envelope?.contexts?.some((c) => c.type === 'estate' && c.roles?.includes('estate_admin'));
}
