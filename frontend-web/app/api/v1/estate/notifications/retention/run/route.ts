import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdminContext, runRetentionSweep } from '@/src/server/estate/notifications';

// POST /api/v1/estate/notifications/retention/run — apply the estate's schedule now (estate admin only).
//
// The sweep runs in the database (estate_notifications_apply_retention, SECURITY DEFINER, service_role
// only) and this route only calls it and reports the counters. That is deliberate: the BEFORE DELETE
// guard that refuses to purge a pinned row, a protected category or a held estate lives behind that
// function, and a second implementation here would be a second set of rules to keep true.
//
// Archiving is reversible and the sweep is idempotent, so pressing this twice in a meeting is safe. What
// is NOT reversible is a purge past the horizon — which is why a policy has to opt into purging at all.
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await requireAdminContext(supabase, user.id);
    return NextResponse.json(await runRetentionSweep(supabase, ctx.estateId, user.id));
  } catch (error) { return handleApiError(error, 'Failed to run notification retention'); }
}
