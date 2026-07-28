import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext } from '@/src/server/estate/resident';

const DEFAULTS = {
  push_enabled: true, email_enabled: true, notify_payments: true, notify_meetings: true,
  notify_elections: true, notify_security: true, notify_maintenance: true, notify_announcements: true, language: 'en',
};

const BOOL_FIELDS = ['push_enabled', 'email_enabled', 'notify_payments', 'notify_meetings', 'notify_elections', 'notify_security', 'notify_maintenance', 'notify_announcements'] as const;

// camelCase (client) ↔ snake_case (db)
const CAMEL_TO_SNAKE: Record<string, string> = {
  pushEnabled: 'push_enabled', emailEnabled: 'email_enabled', notifyPayments: 'notify_payments',
  notifyMeetings: 'notify_meetings', notifyElections: 'notify_elections', notifySecurity: 'notify_security',
  notifyMaintenance: 'notify_maintenance', notifyAnnouncements: 'notify_announcements', language: 'language',
};

function toClient(row: Record<string, any>) {
  return {
    pushEnabled: row.push_enabled, emailEnabled: row.email_enabled, notifyPayments: row.notify_payments,
    notifyMeetings: row.notify_meetings, notifyElections: row.notify_elections, notifySecurity: row.notify_security,
    notifyMaintenance: row.notify_maintenance, notifyAnnouncements: row.notify_announcements, language: row.language,
  };
}

// GET /api/v1/estate/settings — returns saved settings or defaults.
export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    const { data: row, error } = await supabase.from('estate_member_settings').select('*').eq('estate_id', ctx.estateId).eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json(toClient(row ?? DEFAULTS));
  } catch (error) { return handleApiError(error, 'Failed to load settings'); }
}

// PATCH /api/v1/estate/settings — upsert the member's settings.
export async function PATCH(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    const body = await request.json();

    // Whitelist + coerce the incoming patch to db columns.
    const patch: Record<string, any> = {};
    for (const [camel, snake] of Object.entries(CAMEL_TO_SNAKE)) {
      if (!(camel in body)) continue;
      if (snake === 'language') patch.language = String(body.language).slice(0, 10);
      else if ((BOOL_FIELDS as readonly string[]).includes(snake)) patch[snake] = !!body[camel];
    }

    // Merge onto the existing row (or defaults) so a partial PATCH never wipes
    // other preferences back to default.
    const { data: existing } = await supabase.from('estate_member_settings').select('*').eq('estate_id', ctx.estateId).eq('user_id', user.id).maybeSingle();
    const base = existing
      ? {
          push_enabled: existing.push_enabled, email_enabled: existing.email_enabled, notify_payments: existing.notify_payments,
          notify_meetings: existing.notify_meetings, notify_elections: existing.notify_elections, notify_security: existing.notify_security,
          notify_maintenance: existing.notify_maintenance, notify_announcements: existing.notify_announcements, language: existing.language,
        }
      : DEFAULTS;

    const { data: row, error } = await supabase.from('estate_member_settings').upsert({
      estate_id: ctx.estateId, user_id: user.id, ...base, ...patch, updated_at: new Date().toISOString(),
    }, { onConflict: 'estate_id,user_id' }).select('*').single();
    if (error) throw error;
    return NextResponse.json(toClient(row));
  } catch (error) { return handleApiError(error, 'Failed to update settings'); }
}
