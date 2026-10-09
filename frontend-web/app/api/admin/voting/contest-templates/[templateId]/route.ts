import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { hasContestantSlot, isValidStatus, mapOverlayRow, mapSlotRow, mapTemplateRow } from '../_shared';

type RouteContext = { params: Promise<{ templateId: string }> };

// GET /api/admin/voting/contest-templates/[templateId] — single template with slots+overlays.
export async function GET(request: Request, ctx: RouteContext) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { templateId } = await ctx.params;

    const supabase = createAdminClient();
    const { data: template, error } = await supabase
      .from('contest_templates')
      .select('*')
      .eq('id', templateId)
      .maybeSingle();

    if (error) {
      console.error('[admin/voting/contest-templates GET]', error.message);
      return errorResponse('Failed to load template', 500);
    }
    if (!template) return errorResponse('Template not found', 404);

    const [{ data: slotRows, error: slotsError }, { data: overlayRows, error: overlaysError }] =
      await Promise.all([
        supabase.from('template_slots').select('*').eq('template_id', templateId).order('slot_order', { ascending: true }),
        supabase
          .from('template_text_overlays')
          .select('*')
          .eq('template_id', templateId)
          .order('z_index', { ascending: true }),
      ]);

    if (slotsError) {
      console.error('[admin/voting/contest-templates GET] slots:', slotsError.message);
      return errorResponse('Failed to load template slots', 500);
    }
    if (overlaysError) {
      console.error('[admin/voting/contest-templates GET] overlays:', overlaysError.message);
      return errorResponse('Failed to load template overlays', 500);
    }

    return successResponse({
      success: true,
      template: {
        ...mapTemplateRow(template),
        slots: (slotRows ?? []).map(mapSlotRow),
        textOverlays: (overlayRows ?? []).map(mapOverlayRow),
      },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load contest template');
  }
}

// PATCH /api/admin/voting/contest-templates/[templateId]
// Allows updating name/status/width/height/aspectRatio. connect_contest_id
// and contest_id are immutable after creation (not accepted here) — an admin
// who needs the template on a different contest must create a new one.
export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { templateId } = await ctx.params;
    const body = await request.json().catch(() => null);
    if (!body) return errorResponse('Invalid JSON body', 400);

    const supabase = createAdminClient();
    const { data: existing, error: fetchError } = await supabase
      .from('contest_templates')
      .select('id, status')
      .eq('id', templateId)
      .maybeSingle();

    if (fetchError) {
      console.error('[admin/voting/contest-templates PATCH]', fetchError.message);
      return errorResponse('Failed to load template', 500);
    }
    if (!existing) return errorResponse('Template not found', 404);

    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return errorResponse('name must be a non-empty string', 400);
      }
      updates.name = body.name.trim();
    }

    if (body.width !== undefined) updates.width = body.width;
    if (body.height !== undefined) updates.height = body.height;
    if (body.aspectRatio !== undefined) updates.aspect_ratio = body.aspectRatio;

    if (body.status !== undefined) {
      if (!isValidStatus(body.status)) {
        return errorResponse("status must be one of 'draft', 'active', 'archived'", 400);
      }
      // Going to 'active' requires at least one contestant slot to already
      // exist — an active template with no contestant slot is exactly the
      // "looks configured but isn't" trap (AD-003/CS-004).
      if (body.status === 'active') {
        const ok = await hasContestantSlot(templateId);
        if (!ok) {
          return errorResponse(
            "Cannot activate: template has no slot with slotType 'contestant'. Configure a contestant slot first.",
            400,
          );
        }
      }
      updates.status = body.status;
    }

    // connect_contest_id / contest_id are deliberately not settable here.

    if (Object.keys(updates).length === 0) {
      return errorResponse('No updatable fields provided', 400);
    }

    const { data: updated, error: updateError } = await supabase
      .from('contest_templates')
      .update(updates)
      .eq('id', templateId)
      .select('*')
      .single();

    if (updateError) {
      console.error('[admin/voting/contest-templates PATCH] update:', updateError.message);
      return errorResponse('Failed to update template', 500);
    }

    return successResponse({ success: true, template: mapTemplateRow(updated) });
  } catch (error) {
    return handleApiError(error, 'Failed to update contest template');
  }
}

// DELETE /api/admin/voting/contest-templates/[templateId]
// Hard delete (cascades to slots/overlays). Refused with 409 while the
// template is 'active' — an admin must archive it first, so a live
// compositing path is never killed with no warning.
export async function DELETE(request: Request, ctx: RouteContext) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { templateId } = await ctx.params;

    const supabase = createAdminClient();
    const { data: existing, error: fetchError } = await supabase
      .from('contest_templates')
      .select('id, status')
      .eq('id', templateId)
      .maybeSingle();

    if (fetchError) {
      console.error('[admin/voting/contest-templates DELETE]', fetchError.message);
      return errorResponse('Failed to load template', 500);
    }
    if (!existing) return errorResponse('Template not found', 404);

    if ((existing as any).status === 'active') {
      return errorResponse('Cannot delete an active template — archive it first.', 409);
    }

    const { error: deleteError } = await supabase.from('contest_templates').delete().eq('id', templateId);
    if (deleteError) {
      console.error('[admin/voting/contest-templates DELETE]', deleteError.message);
      return errorResponse('Failed to delete template', 500);
    }

    return successResponse({ success: true });
  } catch (error) {
    return handleApiError(error, 'Failed to delete contest template');
  }
}
