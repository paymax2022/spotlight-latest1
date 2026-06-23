import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { appendAuditLog } from '@/src/server/voting/audit.service';

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
    return successResponse({ success: true, packages: data ?? [] });
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
        starts_at: body.startsAt ?? null,
        ends_at: body.endsAt ?? null,
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
