// Estate notification inbox rules for the BFF (estate-d M18: EST-UAT-0359, defect ESTD-D008 —
// close-out Phase 2.5a).
//
// What lives where: the archive/purge SEMANTICS are in the database
// (supabase/migrations/20271099000070_estate_notifications_archive.sql — the sweep function and the
// BEFORE DELETE purge guard), and the caller-facing rules are in
// backend/internal/estate/notifications_retention.go. This file is the BFF mirror of that Go half: the
// same three inbox views, the same category domain, the same page limits, owner-only writes, and the
// same audit action names — so a retention change is traceable whichever surface it was made from.
//
// Nothing in here deletes a notification. The only purge path is estate_notifications_apply_retention(),
// which the retention route calls through RPC and whose guard trigger refuses a pinned row, a protected
// category, or an estate under legal hold.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '@/src/lib/api/responses';
import { getResidentContext } from '@/src/server/estate/resident';

export const NOTIF_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A notification is one recipient's copy: "not yours" and "not here" are the same 404, because
// distinguishing them would leak the existence of somebody else's inbox rows.
export const NOTIF_COLS = 'id, estate_id, category, title, body, deep_link, read_at, archived_at, pinned, created_at';

// Mirrors notifCategories in the Go service, which mirrors the estate_notifications.category CHECK in
// 20260622020001_estate_modules_38_46.sql. A policy naming "emergencz" would otherwise be a row that
// the database accepts and that protects nothing.
export const NOTIF_CATEGORIES = [
  'general', 'payment', 'meeting', 'election', 'security',
  'maintenance', 'facility', 'announcement', 'system',
];

export const INBOX_STATES = ['active', 'archived', 'all'];

export const DEFAULT_ARCHIVE_DAYS = 90;
export const DEFAULT_KEEP_CATEGORIES = ['security', 'system'];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MIN_SEARCH_LEN = 2;

export type InboxFilter = {
  state: string;
  unreadOnly: boolean;
  category: string;
  q: string;
  limit: number;
  offset: number;
};

export function mapEstateNotification(row: any) {
  // camelCase keys and `category` are this BFF's pre-existing contract with the mobile app
  // (src/features/notifications/api.ts). The Go surface answers the same row with snake_case and `kind`;
  // the envelope around it (state/total/limit/offset) matches Go, the item shape stays the BFF's.
  return {
    id: row.id,
    estateId: row.estate_id,
    category: row.category,
    title: row.title,
    body: row.body ?? undefined,
    deepLink: row.deep_link ?? undefined,
    readAt: row.read_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    pinned: !!row.pinned,
    createdAt: row.created_at,
  };
}

/** Read one inbox selector off the query string, rejecting what the Go side rejects. */
export function parseInboxFilter(sp: URLSearchParams): InboxFilter {
  const state = (sp.get('state') ?? 'active').trim();
  if (!INBOX_STATES.includes(state)) throw new ApiError('state must be active, archived or all', 400);

  const unreadOnly = /^(1|true|yes)$/i.test(sp.get('unread_only') ?? '');

  const category = (sp.get('category') ?? '').trim();
  if (category && !NOTIF_CATEGORIES.includes(category)) {
    throw new ApiError('Unknown notification category', 400);
  }

  const q = (sp.get('q') ?? '').trim();
  if (q.length > 0 && q.length < MIN_SEARCH_LEN) {
    throw new ApiError('A search term of at least 2 characters is required', 400);
  }
  // PostgREST's `or=(...)` filter grammar uses these as separators, so a term containing them would be
  // parsed as extra filters rather than searched for. `%` and `_` stay — they widen a substring match,
  // they never narrow one or reach outside the two columns.
  if (/[,()]/.test(q)) throw new ApiError('A search term may not contain , ( or )', 400);

  let limit = DEFAULT_LIMIT;
  if (sp.get('limit')) {
    limit = Number(sp.get('limit'));
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new ApiError('limit must be between 1 and 200', 400);
    }
  }
  let offset = Number(sp.get('offset') ?? 0);
  if (!Number.isInteger(offset) || offset < 0) offset = 0;

  return { state, unreadOnly, category, q, limit, offset };
}

/**
 * Build the caller's inbox query. `count: 'exact'` answers "how many match" even when the page is
 * shorter, which is what makes truncation visible instead of silent — the number the old 100-row cap hid.
 */
export async function listInbox(supabase: SupabaseClient, estateId: string, userId: string, f: InboxFilter) {
  let query = supabase
    .from('estate_notifications')
    .select(NOTIF_COLS, { count: 'exact' })
    .eq('estate_id', estateId)
    .eq('user_id', userId);

  if (f.state === 'active') query = query.is('archived_at', null);
  else if (f.state === 'archived') query = query.not('archived_at', 'is', null);
  if (f.unreadOnly) query = query.is('read_at', null);
  if (f.category) query = query.eq('category', f.category);
  if (f.q) query = query.or(`title.ilike.%${f.q}%,body.ilike.%${f.q}%`);

  const { data: rows, count, error } = await query
    // Pinned first, then newest: paging past the first page must not walk over the notice somebody
    // marked must-not-lose.
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .range(f.offset, f.offset + f.limit - 1);
  if (error) throw error;

  return {
    data: (rows ?? []).map(mapEstateNotification),
    total: count ?? 0,
    limit: f.limit,
    offset: f.offset,
    state: f.state,
    // The envelope mirrors NotificationPage in the Go service key for key, so a client that pages one
    // surface can page the other with the same code.
    unread_only: f.unreadOnly,
  };
}

/** Fetch the caller's own notification, or answer the same 404 for somebody else's. */
export async function getOwnNotification(supabase: SupabaseClient, estateId: string, userId: string, id: string) {
  if (!NOTIF_UUID_RE.test(id)) throw new ApiError('Invalid notification ID', 400);
  const { data, error } = await supabase
    .from('estate_notifications')
    .select(NOTIF_COLS)
    .eq('id', id)
    .eq('estate_id', estateId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError('Notification not found', 404);
  return data as any;
}

export async function patchOwnNotification(supabase: SupabaseClient, estateId: string, userId: string,
  id: string, patch: Record<string, unknown>) {
  const row = await getOwnNotification(supabase, estateId, userId, id);
  const { data, error } = await supabase
    .from('estate_notifications')
    .update(patch)
    .eq('id', row.id)
    .eq('estate_id', estateId)
    .eq('user_id', userId)
    .select(NOTIF_COLS)
    .single();
  if (error) throw error;
  return mapEstateNotification(data);
}

// Snake_case throughout: this document is the same answer NotificationRetentionPolicy in the Go service
// gives, and an admin console written against either surface should read one shape.
export type RetentionPolicy = {
  estate_id: string;
  enabled: boolean;
  archive_after_days: number;
  purge_after_days: number | null;
  keep_categories: string[];
  /** true when the estate has never written a policy and these are the defaults the sweep applies. */
  defaulted: boolean;
  updated_by?: string;
  updated_at?: string;
};

export type RetentionPolicyPatch = {
  enabled?: boolean;
  archive_after_days?: number;
  purge_after_days?: number | null;
  keep_categories?: string[];
};

export async function readRetentionPolicy(supabase: SupabaseClient, estateId: string): Promise<RetentionPolicy> {
  const { data, error } = await supabase
    .from('estate_notification_retention_policies')
    .select('enabled, archive_after_days, purge_after_days, keep_categories, updated_by, updated_at')
    .eq('estate_id', estateId)
    .maybeSingle();
  if (error) throw error;

  // An absent row is not a policy of nothing: the sweep applies its documented defaults, and callers
  // have to be able to tell "defaults" from "a decision somebody made".
  if (!data) {
    return {
      estate_id: estateId, enabled: true, archive_after_days: DEFAULT_ARCHIVE_DAYS, purge_after_days: null,
      keep_categories: [...DEFAULT_KEEP_CATEGORIES], defaulted: true,
    };
  }
  const row = data as any;
  const keep = Array.isArray(row.keep_categories) && row.keep_categories.length > 0
    ? row.keep_categories : [...DEFAULT_KEEP_CATEGORIES];
  const purge = Number(row.purge_after_days);
  return {
    estate_id: estateId,
    enabled: !!row.enabled,
    archive_after_days: Number(row.archive_after_days),
    purge_after_days: Number.isFinite(purge) && purge > 0 ? purge : null,
    keep_categories: keep,
    defaulted: false,
    updated_by: row.updated_by ?? undefined,
    updated_at: row.updated_at ?? undefined,
  };
}

/**
 * Write the estate's inbox schedule. Absent fields keep the current value rather than being read as zero,
 * so PATCHing one number cannot silently set the others to 0. keep_categories REPLACES the list: a list
 * is only worth sending if sending a shorter one takes protection away.
 */
export async function writeRetentionPolicy(supabase: SupabaseClient, estateId: string, actorId: string,
  patch: RetentionPolicyPatch): Promise<RetentionPolicy> {
  const cur = await readRetentionPolicy(supabase, estateId);

  const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : cur.enabled;
  const archiveAfterDays = Number.isFinite(Number(patch.archive_after_days))
    ? Number(patch.archive_after_days) : cur.archive_after_days;

  let purgeAfterDays = cur.purge_after_days;
  if (patch.purge_after_days !== undefined) {
    // 0 and null are both the wire spelling of "never purge".
    purgeAfterDays = patch.purge_after_days === null || Number(patch.purge_after_days) === 0
      ? null : Number(patch.purge_after_days);
  }

  let keepCategories = cur.keep_categories;
  if (Array.isArray(patch.keep_categories)) {
    const seen: string[] = [];
    for (const raw of patch.keep_categories) {
      const c = String(raw).trim();
      if (!NOTIF_CATEGORIES.includes(c)) throw new ApiError(`Unknown notification category: ${c}`, 400);
      if (!seen.includes(c)) seen.push(c);
    }
    keepCategories = seen;
  }

  if (archiveAfterDays <= 0
    || (purgeAfterDays !== null && purgeAfterDays <= 0)
    || (purgeAfterDays !== null && purgeAfterDays < archiveAfterDays)) {
    throw new ApiError('Retention days must be positive and purge cannot be scheduled before archive', 400);
  }

  const { error } = await supabase.from('estate_notification_retention_policies').upsert({
    estate_id: estateId,
    enabled,
    archive_after_days: archiveAfterDays,
    purge_after_days: purgeAfterDays,
    keep_categories: keepCategories,
    updated_by: actorId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'estate_id' });
  if (error) throw error;

  // Same action name the Go service writes (notifications_retention.go), so one query over
  // estate_audit_log finds the change whoever made it.
  await auditRetention(supabase, estateId, actorId, 'NOTIFICATION_RETENTION_SET', {
    enabled, archive_after_days: archiveAfterDays, purge_after_days: purgeAfterDays,
    keep_categories: keepCategories,
  });

  return readRetentionPolicy(supabase, estateId);
}

/** Run the estate's schedule now. The sweep is idempotent; a purge past the horizon is not, which is
 *  why purging has to be opted into by the policy at all. */
export async function runRetentionSweep(supabase: SupabaseClient, estateId: string, actorId: string) {
  const { data, error } = await supabase.rpc('estate_notifications_apply_retention', { p_estate_id: estateId });
  if (error) throw error;

  const doc: any = typeof data === 'string' ? JSON.parse(data) : (data ?? {});
  const counts = {
    notifications_archived: Number(doc.archived ?? 0),
    notifications_purged: Number(doc.purged ?? 0),
  };

  await auditRetention(supabase, estateId, actorId, 'NOTIFICATION_RETENTION_RUN', counts);
  return { estate_id: estateId, ...counts };
}

async function auditRetention(supabase: SupabaseClient, estateId: string, actorId: string,
  action: string, metadata: Record<string, unknown>): Promise<void> {
  // A failed audit write must not fail the admin's action — the policy row is already committed, and
  // rolling the answer back would leave the caller believing the window was still the old one.
  const { error } = await supabase.from('estate_audit_log').insert({
    estate_id: estateId, actor_id: actorId, action, subject_type: 'estate', subject_id: estateId, metadata,
  });
  if (error) console.error(`[estate-notifications] audit ${action} failed:`, error.message);
}

/** Resident context for a personal inbox read/write. */
export async function requireInboxContext(supabase: SupabaseClient, userId: string) {
  const ctx = await getResidentContext(supabase, userId);
  if (!ctx) throw new ApiError('Not a resident of any estate', 403);
  return ctx;
}

/** Estate admin context — the retention plane decides how long evidence stays readable, so a member
 *  cannot read or move it. */
export async function requireAdminContext(supabase: SupabaseClient, userId: string) {
  const ctx = await getResidentContext(supabase, userId);
  if (!ctx) throw new ApiError('Not a resident of any estate', 403);
  if (ctx.role !== 'estate_admin') throw new ApiError('Admin access required', 403);
  return ctx;
}
