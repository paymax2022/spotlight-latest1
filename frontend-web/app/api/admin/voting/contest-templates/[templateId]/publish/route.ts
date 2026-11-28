/**
 * POST /api/admin/voting/contest-templates/[templateId]/publish
 *
 * The whole publication rule lives in `publish_contest_template` (`20272300000000`):
 * the row must exist, must be linked to a Connect contest (or no renderer can resolve
 * it), must have a contestant slot (§10's "looks configured but isn't" trap), and every
 * *other* active row of the same contest is archived inside the same transaction — so no
 * reader ever sees a contest with zero live templates (D2). Re-publishing the row that is
 * already active is legal and answers `archived_ids: []`.
 *
 * The route therefore changes nothing except `p_template_id`/`p_actor` and then re-reads
 * the row: `status`, `published_at` and `published_by` are set by the function and
 * `now()`, so echoing the request would be a claim about the database rather than a
 * fact from it.
 */
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { callStudioRpc, mapTemplateRow, readStudioRow } from '../../_shared';
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
      'publish_contest_template',
      { p_template_id: templateUuid, p_actor: uuidOr(identity?.actorId) },
      '[admin/voting/contest-templates/publish POST]',
    );
    if (!rpc.ok) return rpc.response;

    const read = await readStudioRow(supabase, templateUuid, '[admin/voting/contest-templates/publish POST]');
    if (!read.ok) return read.response;

    return successResponse({
      success: true,
      template: mapTemplateRow(read.row),
      archivedIds: Array.isArray(rpc.data?.archived_ids) ? (rpc.data.archived_ids as string[]) : [],
    });
  } catch (error) {
    return handleApiError(error, 'Failed to publish contest template');
  }
}
