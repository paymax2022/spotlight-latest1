// Estate Meetings service (Block 30) — maps estate_meetings / meeting_rsvps /
// meeting_minutes onto the mobile Meeting contract. estate_meetings.status
// already matches the client enum (scheduled|live|ended|cancelled). Returns the
// raw shapes the app expects.

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

export const MEETING_COLUMNS =
  'id, estate_id, title, agenda, mode, location, starts_at, ends_at, status, created_by, created_at';

/** Map an estate_meetings row to the mobile Meeting shape (rsvp counts + my rsvp). */
export async function mapMeeting(supabase: SupabaseClient, row: any, userId: string): Promise<any> {
  const [{ data: rsvps }, { data: profile }] = await Promise.all([
    supabase.from('meeting_rsvps').select('user_id, response').eq('meeting_id', row.id),
    supabase.from('user_profiles').select('full_name').eq('id', row.created_by).maybeSingle(),
  ]);

  const rsvpCounts = { yes: 0, no: 0, maybe: 0 };
  let myRsvp: 'yes' | 'no' | 'maybe' | null = null;
  for (const r of rsvps ?? []) {
    const resp = (r as any).response as 'yes' | 'no' | 'maybe';
    if (resp in rsvpCounts) rsvpCounts[resp] += 1;
    if ((r as any).user_id === userId) myRsvp = resp;
  }

  return {
    id: row.id,
    estateId: row.estate_id,
    title: row.title,
    agenda: row.agenda ?? undefined,
    mode: row.mode,
    location: row.location ?? undefined,
    startsAt: row.starts_at,
    endsAt: row.ends_at ?? undefined,
    status: row.status,
    createdBy: row.created_by,
    createdByName: (profile as any)?.full_name ?? 'Estate',
    createdAt: row.created_at,
    myRsvp,
    rsvpCounts,
  };
}
