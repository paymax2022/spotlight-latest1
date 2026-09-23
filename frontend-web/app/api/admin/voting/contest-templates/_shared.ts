import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';

const VALID_STATUSES = ['draft', 'active', 'archived'] as const;
export type TemplateStatus = (typeof VALID_STATUSES)[number];

export function isValidStatus(value: unknown): value is TemplateStatus {
  return typeof value === 'string' && (VALID_STATUSES as readonly string[]).includes(value);
}

export function mapTemplateRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    connectContestId: row.connect_contest_id,
    contestId: row.contest_id,
    templateUrl: row.template_url,
    thumbnailUrl: row.thumbnail_url,
    fileFormat: row.file_format,
    width: row.width,
    height: row.height,
    aspectRatio: row.aspect_ratio,
    status: row.status,
    version: row.version,
    parentTemplateId: row.parent_template_id,
    isReusable: row.is_reusable,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSlotRow(row: any) {
  return {
    id: row.id,
    templateId: row.template_id,
    slotName: row.slot_name,
    slotType: row.slot_type,
    slotOrder: row.slot_order,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    zIndex: row.z_index,
    scale: row.scale,
    cropMode: row.crop_mode,
    borderRadius: row.border_radius,
    opacity: row.opacity,
    snapToGrid: row.snap_to_grid,
    gridSize: row.grid_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapOverlayRow(row: any) {
  return {
    id: row.id,
    templateId: row.template_id,
    label: row.label,
    fieldType: row.field_type,
    content: row.content,
    x: row.x,
    y: row.y,
    fontSize: row.font_size,
    fontWeight: row.font_weight,
    color: row.color,
    zIndex: row.z_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * True if `templateId` currently has at least one `slot_type = 'contestant'`
 * row in template_slots. Shared by:
 *   - PATCH .../[templateId] when moving status -> 'active'
 *   - PUT .../[templateId]/slots when the template's CURRENT status is
 *     already 'active' (replacing the slot list on a live template must not
 *     be able to strip its last contestant slot without an explicit
 *     archive-first step).
 *
 * An active template with no contestant slot is exactly the "looks
 * configured but isn't" trap this module exists to prevent — see brief
 * AD-003/CS-004.
 */
export async function hasContestantSlot(templateId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('template_slots')
    .select('id')
    .eq('template_id', templateId)
    .eq('slot_type', 'contestant')
    .limit(1);

  if (error) {
    throw new ApiError(`Failed to check template slots: ${error.message}`, 500);
  }
  return Boolean(data && data.length > 0);
}
