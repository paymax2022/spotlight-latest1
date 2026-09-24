import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { mapSlotRow } from '../../_shared';

type RouteContext = { params: Promise<{ templateId: string }> };

const VALID_SLOT_TYPES = new Set(['contestant', 'runner_up', 'badge', 'logo', 'custom']);
const VALID_CROP_MODES = new Set(['cover', 'contain', 'fill', 'none']);

interface SlotInput {
  slotName: string;
  slotType: string;
  slotOrder: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  scale: number;
  cropMode: string;
  borderRadius: number;
  opacity: number;
  snapToGrid?: boolean;
  gridSize?: number;
}

function validateSlots(raw: unknown): { ok: true; slots: SlotInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'slots must be an array' };

  const slots: SlotInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (!s || typeof s !== 'object') return { ok: false, error: `slots[${i}] must be an object` };

    const required: (keyof SlotInput)[] = [
      'slotName', 'slotType', 'slotOrder', 'x', 'y', 'width', 'height',
      'rotation', 'zIndex', 'scale', 'cropMode', 'borderRadius', 'opacity',
    ];
    for (const field of required) {
      if (s[field] === undefined) return { ok: false, error: `slots[${i}].${field} is required` };
    }
    if (typeof s.slotName !== 'string' || !s.slotName.trim()) {
      return { ok: false, error: `slots[${i}].slotName must be a non-empty string` };
    }
    if (!VALID_SLOT_TYPES.has(s.slotType)) {
      return { ok: false, error: `slots[${i}].slotType must be one of ${[...VALID_SLOT_TYPES].join(', ')}` };
    }
    if (!VALID_CROP_MODES.has(s.cropMode)) {
      return { ok: false, error: `slots[${i}].cropMode must be one of ${[...VALID_CROP_MODES].join(', ')}` };
    }
    const numericFields: (keyof SlotInput)[] = [
      'slotOrder', 'x', 'y', 'width', 'height', 'rotation', 'zIndex', 'scale', 'borderRadius', 'opacity',
    ];
    for (const field of numericFields) {
      if (typeof s[field] !== 'number' || !Number.isFinite(s[field] as number)) {
        return { ok: false, error: `slots[${i}].${field} must be a number` };
      }
    }

    slots.push({
      slotName: s.slotName,
      slotType: s.slotType,
      slotOrder: s.slotOrder,
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height,
      rotation: s.rotation,
      zIndex: s.zIndex,
      scale: s.scale,
      cropMode: s.cropMode,
      borderRadius: s.borderRadius,
      opacity: s.opacity,
      snapToGrid: typeof s.snapToGrid === 'boolean' ? s.snapToGrid : undefined,
      gridSize: typeof s.gridSize === 'number' ? s.gridSize : undefined,
    });
  }

  return { ok: true, slots };
}

// PUT /api/admin/voting/contest-templates/[templateId]/slots
// Replaces the full slot list for this template in one call. Deletes existing
// slots then inserts the new set (two calls — not a money path, no DB
// function needed). If the template's CURRENT status is 'active', the new
// set must include at least one 'contestant' slot — replacing slots on a
// live template must not be able to silently strip its last contestant slot.
export async function PUT(request: Request, ctx: RouteContext) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { templateId } = await ctx.params;
    const body = await request.json();

    const validated = validateSlots(body?.slots);
    if (!validated.ok) return errorResponse(validated.error, 400);
    const { slots } = validated;

    const supabase = createAdminClient();
    const { data: template, error: fetchError } = await supabase
      .from('contest_templates')
      .select('id, status')
      .eq('id', templateId)
      .maybeSingle();

    if (fetchError) return errorResponse(`Failed to load template: ${fetchError.message}`, 500);
    if (!template) return errorResponse('Template not found', 404);

    const hasContestantSlotInPayload = slots.some((s) => s.slotType === 'contestant');
    if ((template as any).status === 'active' && !hasContestantSlotInPayload) {
      return errorResponse(
        "Cannot replace slots: template is active and the new slot list has no 'contestant' slot. Archive the template first if you need to remove it.",
        400,
      );
    }

    const { error: deleteError } = await supabase.from('template_slots').delete().eq('template_id', templateId);
    if (deleteError) return errorResponse(`Failed to clear existing slots: ${deleteError.message}`, 500);

    if (slots.length === 0) {
      return successResponse({ success: true, slots: [] });
    }

    const rows = slots.map((s) => ({
      template_id: templateId,
      slot_name: s.slotName,
      slot_type: s.slotType,
      slot_order: s.slotOrder,
      x: s.x,
      y: s.y,
      width: s.width,
      height: s.height,
      rotation: s.rotation,
      z_index: s.zIndex,
      scale: s.scale,
      crop_mode: s.cropMode,
      border_radius: s.borderRadius,
      opacity: s.opacity,
      ...(s.snapToGrid !== undefined ? { snap_to_grid: s.snapToGrid } : {}),
      ...(s.gridSize !== undefined ? { grid_size: s.gridSize } : {}),
    }));

    const { data: inserted, error: insertError } = await supabase.from('template_slots').insert(rows).select('*');
    if (insertError) return errorResponse(`Failed to insert slots: ${insertError.message}`, 500);

    return successResponse({ success: true, slots: (inserted ?? []).map(mapSlotRow) });
  } catch (error) {
    return handleApiError(error, 'Failed to replace template slots');
  }
}
