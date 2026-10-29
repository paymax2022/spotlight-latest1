// Pure gate logic for the provider portal. No React Native or '@/' imports so it
// runs under node:test.
//
// This is a UX gate: it decides which screen to SHOW. Every provider-side API
// route still enforces ownership and approval on the server, so hiding a screen
// here never grants or removes access (ADR-PR915 provider-portal-capabilities).

export type ProviderType =
  | 'doctor'
  | 'vet'
  | 'pharmacy'
  | 'lab'
  | 'restaurant'
  | 'rider'
  | 'driver'
  | 'marketplace_seller'
  | 'event_organiser'
  | 'estate_manager'
  | 'property_manager'
  | 'association_creator'
  | 'crowdfunding_creator'
  | 'bus_owner';

export interface ProviderCapability {
  type: ProviderType;
  providerId: string;
  displayName: string;
  status: string;
  approved: boolean;
}

export interface ProviderCapabilityWire {
  type: string;
  provider_id: string;
  display_name?: string;
  status?: string;
  approved?: boolean;
}

/** Fail closed: only a literal `true` counts as approved. */
export function mapCapability(raw: ProviderCapabilityWire): ProviderCapability {
  return {
    type: raw.type as ProviderType,
    providerId: raw.provider_id,
    displayName: raw.display_name ?? '',
    status: raw.status ?? '',
    approved: raw.approved === true,
  };
}

export interface GateRule {
  type: ProviderType;
  /** Absolute path prefix of the gated screens. '' gates the whole layout group. */
  prefix: string;
  /**
   * Paths under the prefix that stay reachable without approval — the onboarding
   * and verification-status screens an applicant must be able to open.
   */
  open?: readonly string[];
  /**
   * When true the rule matches only `prefix` itself, not its children. Used where
   * a provider console shares a path segment with a customer screen (e.g.
   * `/food/restaurant` is the owner console while `/food/restaurant/<id>` is the
   * customer's view of an outlet).
   */
  exact?: boolean;
}

export type GateDecision =
  | { kind: 'allow' }
  | { kind: 'pending'; type: ProviderType }
  | { kind: 'deny'; type: ProviderType };

function normalise(path: string): string {
  // Hardening: lower-case and collapse repeated slashes so look-alike spellings
  // of a gated path cannot slip past the prefix match.
  const p = path.split('?')[0].toLowerCase().replace(/\/{2,}/g, '/');
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

/** The path relative to the rule prefix, or null when the rule does not apply. */
function relative(path: string, prefix: string): string | null {
  if (prefix === '') return path.replace(/^\/+/, '');
  if (path === prefix) return '';
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : null;
}

function isOpen(rel: string, open: readonly string[]): boolean {
  return open.some((o) => rel === o || rel.startsWith(`${o}/`));
}

export function decideGate(
  pathname: string,
  rules: readonly GateRule[],
  caps: readonly ProviderCapability[],
): GateDecision {
  const path = normalise(pathname);
  for (const rule of rules) {
    if (rule.exact && path !== normalise(rule.prefix)) continue;
    const rel = relative(path, rule.prefix);
    if (rel === null) continue;
    if (isOpen(rel, rule.open ?? [])) return { kind: 'allow' };
    const own = caps.filter((c) => c.type === rule.type);
    if (own.some((c) => c.approved)) return { kind: 'allow' };
    return own.length > 0 ? { kind: 'pending', type: rule.type } : { kind: 'deny', type: rule.type };
  }
  return { kind: 'allow' };
}
