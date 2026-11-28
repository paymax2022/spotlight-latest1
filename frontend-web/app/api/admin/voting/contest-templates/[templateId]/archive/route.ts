/**
 * POST /api/admin/voting/contest-templates/[templateId]/archive
 *
 * Archiving belongs to `archive_contest_template`, not to a `PATCH {status}` — which is
 * what the legacy editor does and why a template could be "archived" without the studio
 * ever learning that it went out of circulation. The function is idempotent and says so:
 * a second press answers `changed: false`, so the console can report "already archived"
 * instead of pretending a second event happened. `published_at`/`published_by` stay on the
 * row (they are the only record that it was ever live, which the versions panel reads), and
 * this route's job is to hand back the row as stored plus that boolean.
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
      'archive_contest_template',
      { p_template_id: templateUuid, p_actor: uuidOr(identity?.actorId) },
      '[admin/voting/contest-templates/archive POST]',
    );
    if (!rpc.ok) return rpc.response;

    const read = await readStudioRow(supabase, templateUuid, '[admin/voting/contest-templates/archive POST]');
    if (!read.ok) return read.response;

    return successResponse({
      success: true,
      template: mapTemplateRow(read.row),
      // The function's own verdict, kept a JSON boolean: the row's `status` cannot tell a
      // first archive from a second press, and re-deriving it here would be a second copy
      // of a rule the migration already owns.
      changed: rpc.data?.changed === true,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to archive contest template');
  }
}
