import { createAdminClient } from '@/lib/supabase/server';

interface AuditEntry {
  actorId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  contestId?: string;
  contestantId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  reason?: string;
  ipAddress?: string;
  deviceFingerprint?: string;
  userAgent?: string;
}

export async function appendAuditLog(entry: AuditEntry): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from('vote_audit_logs').insert({
    actor_id: entry.actorId,
    actor_role: entry.actorRole,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    contest_id: entry.contestId ?? null,
    contestant_id: entry.contestantId ?? null,
    old_value: entry.oldValue ?? null,
    new_value: entry.newValue ?? null,
    reason: entry.reason ?? null,
    ip_address: entry.ipAddress ?? null,
    device_fingerprint: entry.deviceFingerprint ?? null,
    user_agent: entry.userAgent ?? null,
  });
}

export async function getAuditLogs(
  contestId: string,
  opts: { entityType?: string; entityId?: string; limit?: number; offset?: number } = {},
) {
  const supabase = createAdminClient();
  let query = supabase
    .from('vote_audit_logs')
    .select('*')
    .eq('contest_id', contestId)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 100)
    .range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 100) - 1);

  if (opts.entityType) query = query.eq('entity_type', opts.entityType);
  if (opts.entityId) query = query.eq('entity_id', opts.entityId);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
