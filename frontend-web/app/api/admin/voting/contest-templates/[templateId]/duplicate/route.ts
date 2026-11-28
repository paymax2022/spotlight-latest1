/**
 * POST /api/admin/voting/contest-templates/[templateId]/duplicate
 *
 * D1: this is the only way a new version id comes into existence. The copy — row,
 * slots, overlays, studio fields — is made inside `duplicate_contest_template`
 * (`20272300000000`), which also decides the next `version` and links
 * `parent_template_id`. The route writes nothing itself; it calls the function and then
 * reads back what the transaction produced, because an admin who duplicates a template
 * is about to edit the copy and needs its slot rows in the same response.
 *
 * Two details are load-bearing:
 *
 * - **`p_actor` is a UUID or `null`.** `created_by` references `user_profiles`, and an
 *   `x-admin-key` caller's actor id is the literal `'api-key'` — inside a `security
 *   definer` function that is a foreign-key violation whose sentence has nothing to do
 *   with what the admin pressed (the precedent the legacy PATCH set at `route.ts:182`).
 * - **the reads are scoped to the new id**, never the one in the path. Answering with the
 *   parent's slots would look exactly right in a test that doesn't distinguish them.
 */
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { callStudioRpc, mapSlotRow, mapTemplateRow, readStudioRow } from '../../_shared';
import { uuidOr } from '@/src/server/template-studio/authoring';

type RouteContext = { params: Promise<{ templateId: string }> };

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const { templateId } = await ctx.params;
    const templateUuid = uuidOr(templateId);
    if (!templateUuid) {
      return errorResponse('templateId must be the UUID of a contest template.', 400, 'template_id_invalid');
    }

    const supabase = createAdminClient();
    const rpc = await callStudioRpc(
      supabase,
      'duplicate_contest_template',
      { p_template_id: templateUuid, p_actor: uuidOr(identity?.actorId) },
      '[admin/voting/contest-templates/duplicate POST]',
    );
    if (!rpc.ok) return rpc.response;

    const newId = typeof rpc.data?.template_id === 'string' ? rpc.data.template_id : null;
    if (!newId) {
      // The function returned without naming the row it inserted, which means its
      // jsonb shape changed underneath this route. Saying "duplicated" without an id
      // would leave the console staring at the parent.
      console.error('[admin/voting/contest-templates/duplicate POST] no template_id in', rpc.data);
      return errorResponse(
        'The duplicate ran but did not report the new template, so nothing was loaded. Reload the list.',
        500,
        'duplicate_result_missing',
      );
    }

    const read = await readStudioRow(
      supabase,
      newId,
      '[admin/voting/contest-templates/duplicate POST]',
    );
    if (!read.ok) return read.response;

    const { data: slotRows, error: slotsError } = await supabase
      .from('template_slots')
      .select('*')
      .eq('template_id', newId)
      .order('slot_order', { ascending: true });
    if (slotsError) {
      console.error('[admin/voting/contest-templates/duplicate POST] slots:', slotsError.message);
      return errorResponse('Failed to load the duplicated template slots', 500, 'template_slots_read_failed');
    }

    return successResponse(
      {
        success: true,
        templateId: newId,
        // The row's own `version`, not the RPC's copy of it: the stored column is what
        // every later read will report (D5).
        version: read.row.version,
        template: mapTemplateRow(read.row),
        slots: (slotRows ?? []).map(mapSlotRow),
      },
      201,
    );
  } catch (error) {
    return handleApiError(error, 'Failed to duplicate contest template');
  }
}
