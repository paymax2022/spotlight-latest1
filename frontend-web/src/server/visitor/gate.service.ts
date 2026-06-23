// Gate service — helpers for guard-facing and gate-event routes.
// All helpers accept a Supabase service-role client (createAdminClient) so RLS is bypassed.

import type { SupabaseClient } from '@supabase/supabase-js';

export type GuardContext = { estateId: string; gateId: string; guardName: string };

/** Returns the guard's context from their active gate_sessions row, or null if none. */
export async function getGuardContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<GuardContext | null> {
  const { data, error } = await supabase
    .from('gate_sessions')
    .select('estate_id, gate_id, guard_name')
    .eq('guard_id', userId)
    .is('shift_end', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    estateId: (data as any).estate_id,
    gateId: (data as any).gate_id,
    guardName: (data as any).guard_name ?? '',
  };
}

/** Map a visitor_gate_events row to the API shape. */
export function mapGateEvent(row: any) {
  return {
    id: row.id,
    estateId: row.estate_id,
    accessCodeId: row.access_code_id ?? null,
    visitorName: row.visitor_name ?? null,
    unitLabel: row.unit_label ?? null,
    gateId: row.gate_id ?? null,
    guardId: row.guard_id ?? null,
    action: row.action,
    reason: row.reason ?? null,
    plate: row.captured_plate ?? null,
    syncStatus: row.sync_status,
    createdAt: row.created_at,
  };
}

/** Map a gate_sessions row to the API shape. */
export function mapSession(row: any) {
  return {
    id: row.id,
    estateId: row.estate_id,
    gateId: row.gate_id,
    gateLabel: row.gate_label ?? null,
    guardId: row.guard_id,
    guardName: row.guard_name ?? null,
    shiftStart: row.shift_start,
    shiftEnd: row.shift_end ?? null,
    handoverNotes: row.handover_notes ?? null,
  };
}

/** Map a visitor_notifications row to the API shape. */
export function mapNotification(row: any) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body ?? null,
    accessCodeId: row.access_code_id ?? null,
    read: row.read ?? false,
    createdAt: row.created_at,
  };
}

/** Map a visitor_blacklist row to the API shape. */
export function mapBlacklist(row: any) {
  return {
    id: row.id,
    matchKind: row.match_kind,
    matchValue: row.match_value,
    name: row.name ?? null,
    reason: row.reason ?? null,
    createdAt: row.created_at,
  };
}

/** Map a visitor_incidents row to the API shape. */
export function mapIncident(row: any) {
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    description: row.description ?? null,
    escalate: row.escalate ?? false,
    status: row.status,
    gateId: row.gate_id ?? null,
    createdAt: row.created_at,
  };
}
