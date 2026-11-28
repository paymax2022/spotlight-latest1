import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { mapSlotRow } from '../../_shared';
import { isEditableStatus, parseStudioSlotFields } from '@/src/server/template-studio/authoring';

type RouteContext = { params: Promise<{ templateId: string }> };

const VALID_SLOT_TYPES = new Set(['contestant', 'runner_up', 'badge', 'logo', 'custom']);
const VALID_CROP_MODES = new Set(['cover', 'contain', 'fill', 'none']);

/**
 * The stored defaults for the four P2 art columns (`20272200000000_contest_photo_blend.sql`),
 * written here rather than left to the DDL because this route *replaces* rows: a
 * payload that omits `anchor` has to produce the same row as one that sends
 * `'auto'`, and the response the admin reads back has to describe the row that
 * actually exists.
 */
const SLOT_ART_DEFAULTS = {
  image_url: null,
  anchor: 'auto',
  bleed: false,
  face_protect: true,
} as const;

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
  /**
   * The slot's own art (spec §4): an overlay cut-out placed in the frame, plus how
   * it is fitted. Validated by `parseStudioSlotFields`, which also applies the same
   * host-trust rule the compositing reader enforces — an art URL the renderer will
   * refuse to fetch is a 400 at save time, not a template that silently composites
   * without its art.
   */
  artColumns: Record<string, unknown>;
}

type SlotsVerdict = { ok: true; slots: SlotInput[] } | { ok: false; error: string; code?: string };

function validateSlots(raw: unknown): SlotsVerdict {
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

    // One validator for both request shapes, and the reason lives here rather than
    // in the create route: `imageUrl` has to pass the same trust test the renderer
    // applies, so a client that can PUT a slot can never store art that will not
    // composite.
    const art = parseStudioSlotFields(s);
    if (!art.ok) {
      return { ok: false, code: art.code, error: `slots[${i}]: ${art.error}` };
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
      artColumns: art.row,
    });
  }

  return { ok: true, slots };
}

/**
 * PUT /api/admin/voting/contest-templates/[templateId]/slots
 *
 * Replaces the full slot list in one call: delete every row for the template, then
 * insert the new set (two calls, not a money path, so no DB transaction is held —
 * and an insert that fails after the delete is recoverable by PUTting the same body
 * again, which is why the refusal checks below all run before the delete).
 *
 * The new set must include at least one 'contestant' slot when the template is
 * active — replacing slots on a live template must not be able to silently strip its
 * last contestant slot.
 *
 * Because rows are rewritten rather than merged, **an omitted art field is a deleted
 * art field**. Slot art is what `contest_photo_assets` rows were composited from, so
 * this route protects it two ways:
 *
 * - `ownsArt` — a payload states `image_url` for every slot, or it is treated as a
 *   client that does not know art exists and cannot delete any (400
 *   `slot_art_would_be_dropped`, naming each URL at risk). The shipped console's
 *   geometry-only PUT therefore keeps working on templates without art and refuses on
 *   templates with it, which is the honest answer: the request would destroy something
 *   the caller cannot see. `null` on every slot is how the studio clears art, and it
 *   satisfies `ownsArt` exactly as a URL does.
 * - `setsArtField` — a payload that names any of the four fields is the studio's own,
 *   so D6 applies to it: writing art onto a published row is 409
 *   `template_is_published`, and duplicating is the way round.
 */
export async function PUT(request: Request, ctx: RouteContext) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { templateId } = await ctx.params;
    const body = await request.json().catch(() => null);
    if (!body) return errorResponse('Invalid JSON body', 400);

    const validated = validateSlots((body as any)?.slots);
    if (!validated.ok) return errorResponse(validated.error, 400, validated.code);
    const { slots } = validated;

    const supabase = createAdminClient();
    const { data: template, error: fetchError } = await supabase
      .from('contest_templates')
      .select('id, status')
      .eq('id', templateId)
      .maybeSingle();

    if (fetchError) {
      console.error('[admin/voting/contest-templates/slots PUT]', fetchError.message);
      return errorResponse('Failed to load template', 500);
    }
    if (!template) return errorResponse('Template not found', 404);

    const hasContestantSlotInPayload = slots.some((s) => s.slotType === 'contestant');
    if ((template as any).status === 'active' && !hasContestantSlotInPayload) {
      return errorResponse(
        "Cannot replace slots: template is active and the new slot list has no 'contestant' slot. Archive the template first if you need to remove it.",
        400,
      );
    }

    // Read what is stored *before* clearing it — the drop guard has nothing to
    // compare against otherwise, and the comparison is the whole point of the check.
    const { data: storedRows, error: storedError } = await supabase
      .from('template_slots')
      .select('id, slot_name, image_url')
      .eq('template_id', templateId);
    if (storedError) {
      console.error('[admin/voting/contest-templates/slots PUT] stored art:', storedError.message);
      return errorResponse('Failed to load stored slots', 500);
    }
    const storedArt = (storedRows ?? []).filter(
      (r: any) => typeof r.image_url === 'string' && r.image_url.trim() !== '',
    );
    const ownsArt = slots.length > 0 && slots.every((s) => s.artColumns.image_url !== undefined);
    const setsArtField = slots.some((s) => Object.keys(s.artColumns).length > 0);

    if (setsArtField && !isEditableStatus((template as any).status)) {
      return errorResponse(
        `A ${String((template as any).status)} template's slots are the ones past renders were produced from, so ` +
          'their art, anchor and bleed settings are read-only. Duplicate the template to edit: the copy comes back as ' +
          'a new draft with the same slots and their art.',
        409,
        'template_is_published',
      );
    }

    if (storedArt.length > 0 && !ownsArt) {
      const atRisk = storedArt
        .map((r: any) => `${r.slot_name ?? 'a slot'} → ${r.image_url}`)
        .join('; ');
      return errorResponse(
        `This replace would delete slot art the new list does not place: ${atRisk}. Slot rows are rewritten, not ` +
          'merged, so a slot that says nothing about its image loses it. Send each stored URL back on the slot that ' +
          'keeps it, or send imageUrl: null on every slot to remove the art on purpose.',
        400,
        'slot_art_would_be_dropped',
      );
    }

    const { error: deleteError } = await supabase.from('template_slots').delete().eq('template_id', templateId);
    if (deleteError) {
      console.error('[admin/voting/contest-templates/slots PUT] clear:', deleteError.message);
      return errorResponse('Failed to clear existing slots', 500);
    }

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
      // Defaults first, then whatever the payload stated: an omitted field stores the
      // column default, a stated field stores the value the validator accepted.
      ...SLOT_ART_DEFAULTS,
      ...s.artColumns,
    }));

    const { data: inserted, error: insertError } = await supabase.from('template_slots').insert(rows).select('*');
    if (insertError) {
      console.error('[admin/voting/contest-templates/slots PUT] insert:', insertError.message);
      return errorResponse('Failed to insert slots', 500);
    }

    return successResponse({ success: true, slots: (inserted ?? []).map(mapSlotRow) });
  } catch (error) {
    return handleApiError(error, 'Failed to replace template slots');
  }
}
