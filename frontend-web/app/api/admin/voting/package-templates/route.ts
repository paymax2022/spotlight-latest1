import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { appendAuditLog } from '@/src/server/voting/audit.service';

/**
 * Reusable voting-package TEMPLATES.
 *
 * vote_packages rows belong to exactly one contest (contest_id is NOT NULL), so
 * there was no way to define a package once and reuse it. Templates are the
 * catalog admins author against; attaching one to a contest clones it into an
 * ordinary vote_packages row (see ./apply/route.ts). The voting hot path never
 * reads this table.
 *
 * ⚠️ `amount` is NAIRA (major units), mirroring vote_packages.amount exactly, so
 * the clone is a straight copy with no scaling. Do not introduce kobo here — a
 * missed conversion on that seam is a 100x mispricing.
 */

const SELECT = 'id,name,description,votes,bonus_votes,amount,currency,is_active,is_recommended,promo_label,display_order,created_at,updated_at';

/** Snake-cased rows out of Postgres, camelCase in the admin console. */
function toClient(r: Record<string, any>) {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    votes: Number(r.votes ?? 0),
    bonusVotes: Number(r.bonus_votes ?? 0),
    amount: Number(r.amount ?? 0), // NAIRA
    currency: r.currency ?? 'NGN',
    isActive: r.is_active !== false,
    isRecommended: Boolean(r.is_recommended),
    promoLabel: r.promo_label ?? '',
    displayOrder: Number(r.display_order ?? 0),
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
  };
}

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    const supabase = createAdminClient();
    let query = supabase
      .from('vote_package_templates')
      .select(SELECT)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (activeOnly) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) return errorResponse(error.message, 500);

    return successResponse({ success: true, templates: (data ?? []).map(toClient) });
  } catch (error) {
    return handleApiError(error, 'Failed to load vote package templates');
  }
}

export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const body = await request.json();

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return errorResponse('name is required', 400);
    const votes = Number(body.votes);
    if (!Number.isFinite(votes) || votes <= 0) return errorResponse('votes must be greater than 0', 400);
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) return errorResponse('amount is required and cannot be negative', 400);
    const bonusVotes = Number(body.bonusVotes ?? 0);
    if (!Number.isFinite(bonusVotes) || bonusVotes < 0) return errorResponse('bonusVotes cannot be negative', 400);

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('vote_package_templates')
      .insert({
        name,
        description: body.description?.trim() || null,
        votes,
        bonus_votes: bonusVotes,
        amount, // NAIRA
        currency: body.currency ?? 'NGN',
        is_active: body.isActive ?? true,
        is_recommended: body.isRecommended ?? false,
        promo_label: body.promoLabel?.trim() || null,
        display_order: Number(body.displayOrder ?? 0),
        created_by: identity.actorId ?? null,
      })
      .select(SELECT)
      .single();

    if (error) return errorResponse(error.message, 500);

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'vote_package_template_created',
      entityType: 'vote_package_template',
      entityId: (data as any).id,
      newValue: body,
    });

    return successResponse({ success: true, template: toClient(data as any) }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create vote package template');
  }
}

export async function PATCH(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const body = await request.json();
    if (!body.id) return errorResponse('id is required', 400);

    const updates: Record<string, unknown> = {};
    const map: Record<string, string> = {
      name: 'name',
      description: 'description',
      votes: 'votes',
      bonusVotes: 'bonus_votes',
      amount: 'amount',
      currency: 'currency',
      isActive: 'is_active',
      isRecommended: 'is_recommended',
      promoLabel: 'promo_label',
      displayOrder: 'display_order',
    };
    for (const [camel, snake] of Object.entries(map)) {
      if (body[camel] !== undefined) updates[snake] = body[camel];
    }

    if (updates.votes !== undefined && Number(updates.votes) <= 0) {
      return errorResponse('votes must be greater than 0', 400);
    }
    if (updates.amount !== undefined && Number(updates.amount) < 0) {
      return errorResponse('amount cannot be negative', 400);
    }
    if (Object.keys(updates).length === 0) return errorResponse('nothing to update', 400);
    updates.updated_at = new Date().toISOString();

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('vote_package_templates')
      .update(updates)
      .eq('id', body.id)
      .select(SELECT)
      .single();

    if (error) return errorResponse(error.message, 500);
    if (!data) return errorResponse('Template not found', 404);

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'vote_package_template_updated',
      entityType: 'vote_package_template',
      entityId: body.id,
      newValue: updates,
    });

    return successResponse({ success: true, template: toClient(data as any) });
  } catch (error) {
    return handleApiError(error, 'Failed to update vote package template');
  }
}

export async function DELETE(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return errorResponse('id is required', 400);

    // Packages already cloned onto a contest are NOT removed: template_id is
    // ON DELETE SET NULL. A contest that is selling votes keeps selling them.
    const supabase = createAdminClient();
    const { error } = await supabase.from('vote_package_templates').delete().eq('id', id);
    if (error) return errorResponse(error.message, 500);

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'vote_package_template_deleted',
      entityType: 'vote_package_template',
      entityId: id,
    });

    return successResponse({ success: true });
  } catch (error) {
    return handleApiError(error, 'Failed to delete vote package template');
  }
}
