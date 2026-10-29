import { NextResponse } from 'next/server';
import { handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { readRetentionPolicy, requireAdminContext, writeRetentionPolicy } from '@/src/server/estate/notifications';
import type { RetentionPolicyPatch } from '@/src/server/estate/notifications';

// GET/PUT /api/v1/estate/notifications/retention — the estate's inbox schedule (estate admin only).
//
// The estate is never taken from the caller: it is derived from the admin's own membership, the same way
// every other estate BFF route does it. A member cannot read or move this setting because it decides how
// long a dispute's evidence stays readable.
//
// PUT is a patch, not a replace: an absent field keeps its current value, so a console that sends one
// number cannot zero the others. The rules it validates against live in
// src/server/estate/notifications.ts, mirrored from the Go service.

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await requireAdminContext(supabase, user.id);
    return NextResponse.json(await readRetentionPolicy(supabase, ctx.estateId));
  } catch (error) { return handleApiError(error, 'Failed to load retention policy'); }
}

export async function PUT(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body: any = await request.json().catch(() => ({}));
    const supabase = createAdminClient();
    const ctx = await requireAdminContext(supabase, user.id);

    const patch: RetentionPolicyPatch = {};
    if (typeof body?.enabled === 'boolean') patch.enabled = body.enabled;
    if (body?.archive_after_days !== undefined) patch.archive_after_days = Number(body.archive_after_days);
    if (body?.purge_after_days !== undefined) {
      patch.purge_after_days = body.purge_after_days === null ? null : Number(body.purge_after_days);
    }
    if (body?.keep_categories !== undefined) patch.keep_categories = body.keep_categories;

    return NextResponse.json(await writeRetentionPolicy(supabase, ctx.estateId, user.id, patch));
  } catch (error) { return handleApiError(error, 'Failed to save retention policy'); }
}
