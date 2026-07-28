// Visitor service — maps the existing visitor_access_codes schema onto the mobile
// client's AccessCode contract (see contracts/visitor.openapi.yaml). Returns the
// raw shapes the app expects. Service-role client (createAdminClient) is used by
// the route handlers, so estate scoping is enforced in code.

import type { SupabaseClient } from '@supabase/supabase-js';

export type ResidentContext = { estateId: string; unit: string; role: string };

export async function getResidentContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<ResidentContext | null> {
  const { data, error } = await supabase
    .from('estate_residents')
    .select('estate_id, unit, role')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { estateId: (data as any).estate_id, unit: (data as any).unit ?? '', role: (data as any).role ?? 'resident' };
}

// code_type enum reconciliation (DB has a narrower set than the client).
const DB_TO_CLIENT: Record<string, string> = { ridehailing: 'ride_hailing', staff: 'domestic_staff', family: 'family_permanent' };
const CLIENT_TO_DB: Record<string, string> = {
  one_time: 'one_time', recurring: 'recurring', multi_day: 'multi_day', delivery: 'delivery',
  ride_hailing: 'ridehailing', domestic_staff: 'staff', contractor: 'contractor',
  event_guest: 'event_guest', family_permanent: 'family',
  // client-only types the DB enum lacks → safest fallback
  time_limited: 'one_time', date_specific: 'one_time', vip: 'one_time', emergency: 'one_time',
};
const PURPOSE_LABEL: Record<string, string> = {
  one_time: 'One-time', time_limited: 'Time-limited', date_specific: 'Date-specific', multi_day: 'Multi-day',
  recurring: 'Recurring', delivery: 'Delivery', ride_hailing: 'Ride', domestic_staff: 'Staff',
  contractor: 'Contractor', event_guest: 'Event guest', family_permanent: 'Family', vip: 'VIP', emergency: 'Emergency',
};
export const toClientCodeType = (db: string): string => DB_TO_CLIENT[db] ?? db;
export const toDbCodeType = (client: string): string => CLIENT_TO_DB[client] ?? 'one_time';

const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** recurrence JSONB {days_of_week:[1..7],time_start,time_end} → "MON,WED 07:00-18:00". */
export function recurrenceToRule(rec: any): string | null {
  if (!rec || !Array.isArray(rec.days_of_week) || rec.days_of_week.length === 0) return null;
  const days = rec.days_of_week.map((n: number) => DOW[(n - 1 + 7) % 7]).join(',');
  const start = rec.time_start ?? '00:00';
  const end = rec.time_end ?? '23:59';
  return `${days} ${start}-${end}`;
}

/** "MON,WED 07:00-18:00" → recurrence JSONB, or null if unparseable. */
export function ruleToRecurrence(rule?: string | null): any | null {
  if (!rule) return null;
  const [daysPart, timePart] = rule.trim().split(/\s+/);
  if (!daysPart) return null;
  const days_of_week = daysPart.split(',').map((d) => DOW.indexOf(d.trim().toUpperCase()) + 1).filter((n) => n >= 1);
  if (days_of_week.length === 0) return null;
  const [time_start, time_end] = (timePart ?? '00:00-23:59').split('-');
  return { days_of_week, time_start: time_start ?? '00:00', time_end: time_end ?? '23:59' };
}

/** Map a visitor_access_codes row to the mobile AccessCode shape (joins host/estate). */
export async function mapAccessCode(supabase: SupabaseClient, row: any): Promise<any> {
  const [{ data: estate }, { data: profile }, { data: resident }] = await Promise.all([
    supabase.from('estates').select('name').eq('id', row.estate_id).maybeSingle(),
    supabase.from('user_profiles').select('full_name').eq('id', row.issued_by).maybeSingle(),
    supabase.from('estate_residents').select('unit').eq('estate_id', row.estate_id).eq('user_id', row.issued_by).maybeSingle(),
  ]);
  const clientType = toClientCodeType(row.code_type);
  return {
    id: row.id,
    estateId: row.estate_id,
    hostResidentId: row.issued_by,
    hostName: (profile as any)?.full_name ?? 'Resident',
    propertyId: '',
    unitLabel: (resident as any)?.unit ?? '',
    estateName: (estate as any)?.name ?? 'Estate',
    codeValue: row.numeric_code,
    qrPayload: `PMX|${row.estate_id}|${row.numeric_code}|${row.valid_until}`,
    codeType: clientType,
    purposeLabel: PURPOSE_LABEL[clientType] ?? 'Guest',
    status: row.status,
    visitor: {
      name: row.visitor_name,
      phone: row.visitor_phone ?? undefined,
      purpose: row.purpose ?? undefined,
      vehiclePlate: row.vehicle_plate ?? undefined,
      isBlacklisted: row.blacklisted ?? false,
    },
    validityStart: row.valid_from,
    validityEnd: row.valid_until,
    maxEntries: row.max_uses,
    entriesUsed: row.used_count,
    usageMode: row.usage_mode ?? 'one_time',
    partySize: row.party_size ?? 1,
    recurrenceRule: recurrenceToRule(row.recurrence) ?? null,
    createdAt: row.created_at,
    createdBy: row.issued_by,
  };
}

export function genNumericCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += Math.floor(Math.random() * 10);
  return s;
}

export const ACCESS_CODE_COLUMNS =
  'id, estate_id, issued_by, visitor_name, visitor_phone, vehicle_plate, purpose, code_type, numeric_code, qr_code, valid_from, valid_until, recurrence, used_count, max_uses, status, blacklisted, usage_mode, party_size, created_at';
