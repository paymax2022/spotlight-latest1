import { createAdminClient } from '@/lib/supabase/server';
import type { UtilityBillerRow, UtilityCategory } from '@/src/server/utility/types';

// ─────────────────────────────────────────────────────────────────────────────
// Central Commission module — read-side helper (REFERENCE integration: utility).
//
// Source of truth: public.commission_config, keyed by
// (service_category, service, service_subtype). This helper resolves the active
// rate row for a resolved (service, subtype), falling back service→'' then null.
// It is READ-ONLY and best-effort: every path is guarded so a lookup failure can
// never break a money path (callers keep their existing behavior on null).
// ─────────────────────────────────────────────────────────────────────────────

export const UTILITY_COMMISSION_CATEGORY = 'Utility_Bills';

export interface CommissionConfigRow {
  id: string;
  service_category: string;
  service: string;
  service_subtype: string;
  fee_model: 'commission' | 'platform_charge' | 'fixed' | 'commission_plus_fee' | 'none';
  commission_bps: number;
  platform_charge_bps: number;
  convenience_fee_kobo: number;
  fixed_fee_kobo: number;
  fee_payer: 'customer' | 'provider' | 'merchant' | 'none';
  currency: string;
  active: boolean;
}

export interface ResolvedCommission {
  service: string | null;
  subtype: string;
  config: CommissionConfigRow | null;
}

// Utility category → commission service name (per the seeded workbook rows).
// Categories not listed here (e.g. 'internet') intentionally resolve to null so
// the caller keeps its legacy utility_products-based behavior untouched.
const CATEGORY_TO_SERVICE: Partial<Record<UtilityCategory, string>> = {
  electricity: 'Electricity',
  cable_tv: 'CableTv',
  airtime: 'Airtime',
  data: 'Data',
  education: 'Education',
};

// Known subtypes per service (from the commission_config seed). Used for a
// best-effort match of a biller onto its network/disco/provider subtype.
const SERVICE_SUBTYPES: Record<string, string[]> = {
  Airtime: ['9mobile', 'MTN', 'GLO', 'Airtel'],
  Data: ['9mobile', 'MTN', 'GLO', 'Airtel', 'Smile', 'Spectranet'],
  Electricity: [
    'Abuja', 'Aba', 'Ikeja', 'Eko', 'Ibadan', 'Yola', 'Kano', 'Kaduna', 'Jos',
    'Enugu', 'Benin', 'PortHarcourt',
  ],
  CableTv: ['DSTV', 'GoTV', 'Startime', 'Showmax'],
  Education: ['WAEC', 'NECO', 'JAMB'],
};

export function utilityCategoryToService(category: UtilityCategory): string | null {
  return CATEGORY_TO_SERVICE[category] ?? null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Reduce a biller code to a comparable token, e.g.
//   vtpass-portharcourt-electric -> portharcourt
//   vtpass-dstv                  -> dstv
//   vtpass-mtn-airtime           -> mtn
function billerCodeToken(code: string): string {
  return normalize(
    code
      .replace(/^vtpass-/i, '')
      .replace(/-(electric|electricity|airtime|data|internet|cabletv|tv|variable)$/i, ''),
  );
}

// Best-effort: map a biller onto one of the known subtypes for its service.
// Exact (normalized) match first to avoid collisions (e.g. Aba vs Abuja), then a
// loose contains match (e.g. 'startimes' -> 'Startime'). Returns '' when nothing
// matches so the caller falls back to the service-level ('') config row.
export function deriveUtilitySubtype(service: string, biller: UtilityBillerRow): string {
  const subtypes = SERVICE_SUBTYPES[service];
  if (!subtypes || subtypes.length === 0) return '';

  const tokens = [billerCodeToken(biller.code), normalize(biller.name)].filter(Boolean);

  // Pass 1: exact normalized equality (most specific, collision-free).
  for (const token of tokens) {
    for (const subtype of subtypes) {
      if (normalize(subtype) === token) return subtype;
    }
  }

  // Pass 2: loose contains (longest subtypes first to prefer specific matches).
  const byLengthDesc = [...subtypes].sort((a, b) => normalize(b).length - normalize(a).length);
  for (const token of tokens) {
    for (const subtype of byLengthDesc) {
      const sub = normalize(subtype);
      if (token.includes(sub) || sub.includes(token)) return subtype;
    }
  }

  return '';
}

function coerceRow(row: Record<string, unknown>): CommissionConfigRow {
  return {
    id: String(row.id),
    service_category: String(row.service_category),
    service: String(row.service),
    service_subtype: String(row.service_subtype ?? ''),
    fee_model: row.fee_model as CommissionConfigRow['fee_model'],
    commission_bps: Number(row.commission_bps ?? 0),
    platform_charge_bps: Number(row.platform_charge_bps ?? 0),
    convenience_fee_kobo: Number(row.convenience_fee_kobo ?? 0),
    fixed_fee_kobo: Number(row.fixed_fee_kobo ?? 0),
    fee_payer: row.fee_payer as CommissionConfigRow['fee_payer'],
    currency: String(row.currency ?? 'NGN'),
    active: Boolean(row.active),
  };
}

// Read the active commission_config row for (service, subtype). Tries the exact
// subtype first, then the service-level ('') row, then null. Best-effort: any DB
// error resolves to null (caller keeps legacy behavior — never throws).
export async function getCommissionConfig(
  service: string,
  subtype: string,
): Promise<CommissionConfigRow | null> {
  try {
    const supabase = createAdminClient();

    if (subtype) {
      const { data } = await supabase
        .from('commission_config')
        .select('*')
        .eq('service_category', UTILITY_COMMISSION_CATEGORY)
        .eq('service', service)
        .eq('service_subtype', subtype)
        .eq('active', true)
        .maybeSingle();
      if (data) return coerceRow(data as Record<string, unknown>);
    }

    const { data: serviceLevel } = await supabase
      .from('commission_config')
      .select('*')
      .eq('service_category', UTILITY_COMMISSION_CATEGORY)
      .eq('service', service)
      .eq('service_subtype', '')
      .eq('active', true)
      .maybeSingle();

    return serviceLevel ? coerceRow(serviceLevel as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Resolve the commission service + subtype + active config for a utility payment.
// Best-effort and non-throwing: on any failure returns a null config so the
// utility flow keeps its existing amounts and behavior.
export async function resolveUtilityCommission(
  category: UtilityCategory,
  biller: UtilityBillerRow,
): Promise<ResolvedCommission> {
  const service = utilityCategoryToService(category);
  if (!service) return { service: null, subtype: '', config: null };
  const subtype = deriveUtilitySubtype(service, biller);
  const config = await getCommissionConfig(service, subtype);
  return { service, subtype, config };
}
