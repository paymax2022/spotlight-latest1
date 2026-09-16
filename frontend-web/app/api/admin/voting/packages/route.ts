import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { appendAuditLog } from '@/src/server/voting/audit.service';

/**
 * A datetime-local input submits '' when left blank, and `?? null` does not catch
 * an empty string — only null/undefined. Passing '' into a timestamptz column
 * makes Postgres reject the whole insert, so leaving the optional availability
 * dates blank failed to save at all.
 */
function optionalTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId');

    const supabase = createAdminClient();
    let query = supabase.from('vote_packages').select('*').order('display_order', { ascending: true });
    if (contestId) query = query.eq('contest_id', contestId);

    const { data, error } = await query;
    if (error) return errorResponse('Failed to load packages', 500);

    // vote_packages stores snake_case; the admin page reads camelCase. Returning
    // rows raw meant pkg.isActive was ALWAYS undefined, so every package rendered
    // greyed-out as inactive no matter what was saved — and pkg.startsAt/endsAt
    // came back undefined, so editing a package silently cleared its dates.
    // Same defect the voting-settings route already carries a note about.
    const packages = (data ?? []).map((r) => ({
      ...r,
      isActive: r.is_active !== false,
      isRecommended: Boolean(r.is_recommended),
      bonusVotes: Number(r.bonus_votes ?? 0),
      promoLabel: r.promo_label ?? '',
      displayOrder: Number(r.display_order ?? 0),
      startsAt: r.starts_at ?? null,
      endsAt: r.ends_at ?? null,
    }));

    return successResponse({ success: true, packages });
  } catch (error) {
    return handleApiError(error, 'Failed to load vote packages');
  }
}

export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const body = await request.json();

    if (!body.contestId) return errorResponse('contestId is required', 400);
    if (!body.name) return errorResponse('name is required', 400);
    if (!body.votes || body.votes <= 0) return errorResponse('votes must be > 0', 400);
    if (body.amount == null || body.amount < 0) return errorResponse('amount is required', 400);

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('vote_packages')
      .insert({
        contest_id: body.contestId,
        name: body.name,
        description: body.description ?? null,
        votes: body.votes,
        bonus_votes: body.bonusVotes ?? 0,
        amount: body.amount,
        currency: body.currency ?? 'NGN',
        is_active: body.isActive ?? true,
        is_recommended: body.isRecommended ?? false,
        promo_label: body.promoLabel ?? null,
        display_order: body.displayOrder ?? 0,
        starts_at: optionalTimestamp(body.startsAt),
        ends_at: optionalTimestamp(body.endsAt),
      })
      .select('*')
      .single();

    if (error) return errorResponse(error.message, 500);

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'vote_package_created',
      entityType: 'vote_package',
      entityId: (data as any).id,
      contestId: body.contestId,
      newValue: body,
    });

    return successResponse({ success: true, package: data }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create vote package');
  }
}

export async function PATCH(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const body = await request.json();
    if (!body.id) return errorResponse('id is required', 400);

    const supabase = createAdminClient();
    const updates: Record<string, unknown> = {};
    const allowed = ['name','description','votes','bonus_votes','amount','currency','is_active','is_recommended','promo_label','display_order','starts_at','ends_at'];
    for (const key of allowed) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (body[camel] !== undefined) updates[key] = body[camel];
      if (body[key] !== undefined) updates[key] = body[key];
    }

    // Same empty-string trap as the create path: editing a package and leaving
    // the optional availability dates blank sent '' into a timestamptz column,
    // which Postgres rejects — so the whole edit failed with a 500.
    for (const key of ['starts_at', 'ends_at']) {
      if (key in updates) updates[key] = optionalTimestamp(updates[key]);
    }

    const { data, error } = await supabase
      .from('vote_packages')
      .update(updates)
      .eq('id', body.id)
      .select('*')
      .single();

    if (error) return errorResponse(error.message, 500);

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'vote_package_updated',
      entityType: 'vote_package',
      entityId: body.id,
      newValue: updates,
    });

    return successResponse({ success: true, package: data });
  } catch (error) {
    return handleApiError(error, 'Failed to update vote package');
  }
}

export async function DELETE(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return errorResponse('id is required', 400);

    const supabase = createAdminClient();
    await supabase.from('vote_packages').update({ is_active: false }).eq('id', id);

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'vote_package_deactivated',
      entityType: 'vote_package',
      entityId: id,
    });

    return successResponse({ success: true });
  } catch (error) {
    return handleApiError(error, 'Failed to delete vote package');
  }
}
