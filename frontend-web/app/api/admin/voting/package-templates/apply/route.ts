import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { appendAuditLog } from '@/src/server/voting/audit.service';

/**
 * Attach voting-package templates to a contest.
 *
 * This is where the association the admin console asks for actually happens.
 * Each selected template is CLONED into an ordinary public.vote_packages row for
 * the contest, carrying template_id for provenance. The legacy paid-vote path
 * (frontend-web/src/server/voting/paid-vote.service.ts — a brownfield-protected
 * file) keeps reading vote_packages exactly as it always has; nothing about the
 * voting hot path changes.
 *
 * Cloning rather than referencing is deliberate. A contest that is selling votes
 * must not have its prices or vote counts change underneath it because someone
 * edited a template later, and it must not lose its packages because a template
 * was deleted. The clone is authoritative from the moment it exists.
 *
 * ⚠️ amount is NAIRA on BOTH tables, so this is a straight copy with no scaling.
 * If you ever find yourself writing `* 100` here, something upstream is wrong.
 *
 * Idempotent: a partial unique index on (contest_id, template_id) means
 * re-applying a template set adds only what is missing instead of stacking
 * duplicate tiers, so the admin can safely press Apply twice.
 */
export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const body = await request.json();

    const contestId = typeof body.contestId === 'string' ? body.contestId.trim() : '';
    if (!contestId) return errorResponse('contestId is required', 400);

    const templateIds: string[] = Array.isArray(body.templateIds)
      ? body.templateIds.filter((v: unknown) => typeof v === 'string' && v.trim() !== '')
      : [];
    if (templateIds.length === 0) return errorResponse('templateIds must contain at least one template', 400);

    const supabase = createAdminClient();

    // The contest must exist. Cloning packages onto a missing contest would fail
    // on the FK anyway, but a 404 says what actually went wrong.
    const { data: contest, error: contestError } = await supabase
      .from('contests')
      .select('id')
      .eq('id', contestId)
      .maybeSingle();
    if (contestError) return errorResponse(contestError.message, 500);
    if (!contest) return errorResponse('Contest not found', 404);

    const { data: templates, error: templateError } = await supabase
      .from('vote_package_templates')
      .select('id,name,description,votes,bonus_votes,amount,currency,is_recommended,promo_label,display_order')
      .in('id', templateIds);
    if (templateError) return errorResponse(templateError.message, 500);

    const found = templates ?? [];
    if (found.length === 0) return errorResponse('None of the given templates exist', 404);

    // Report templates that could not be applied rather than silently dropping
    // them — an admin who selected five tiers and got four needs to know which.
    const foundIds = new Set(found.map((t: any) => t.id));
    const missing = templateIds.filter((id) => !foundIds.has(id));

    // Skip templates already on this contest so Apply is safe to repeat.
    const { data: existing, error: existingError } = await supabase
      .from('vote_packages')
      .select('template_id')
      .eq('contest_id', contestId)
      .not('template_id', 'is', null);
    if (existingError) return errorResponse(existingError.message, 500);

    const already = new Set((existing ?? []).map((r: any) => r.template_id));
    const toInsert = found.filter((t: any) => !already.has(t.id));

    if (toInsert.length === 0) {
      return successResponse({
        success: true,
        applied: 0,
        skipped: found.length,
        missing,
        packages: [],
        message: 'Every selected template is already on this contest.',
      });
    }

    const rows = toInsert.map((t: any) => ({
      contest_id: contestId,
      template_id: t.id,
      name: t.name,
      description: t.description ?? null,
      votes: t.votes,
      bonus_votes: t.bonus_votes ?? 0,
      amount: t.amount, // NAIRA -> NAIRA, no scaling
      currency: t.currency ?? 'NGN',
      is_active: true,
      is_recommended: Boolean(t.is_recommended),
      promo_label: t.promo_label ?? null,
      display_order: t.display_order ?? 0,
    }));

    const { data: inserted, error: insertError } = await supabase
      .from('vote_packages')
      .insert(rows)
      .select('*');
    if (insertError) return errorResponse(insertError.message, 500);

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'vote_package_templates_applied',
      entityType: 'contest',
      entityId: contestId,
      contestId,
      newValue: { templateIds: toInsert.map((t: any) => t.id), applied: rows.length },
    });

    return successResponse({
      success: true,
      applied: inserted?.length ?? 0,
      skipped: found.length - toInsert.length,
      missing,
      packages: inserted ?? [],
    }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to apply vote package templates');
  }
}
