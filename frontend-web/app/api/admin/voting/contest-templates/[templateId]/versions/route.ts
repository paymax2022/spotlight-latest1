/**
 * GET /api/admin/voting/contest-templates/[templateId]/versions
 *
 * The lineage is a tree, not a chain: an admin can duplicate a draft twice, so the tip
 * isn't necessarily the row you were handed. `contest_template_versions` walks up to the
 * root and back down (both with a depth guard, since `parent_template_id` has no cycle
 * constraint) and answers `{ chain: [...] }` sorted `version desc` — live version first,
 * which this route preserves instead of inventing its own sort. Deciding that walk in
 * TypeScript would be a second copy of a rule the database has to enforce anyway.
 *
 * Two things this route deliberately does not do:
 *
 * - it sends no `p_actor` — nothing is written, and a read that passes an actor looks like
 *   an audit event that never happens. The function takes one parameter for that reason;
 * - it does not 404 an unknown id. An empty chain IS the answer for a row that isn't
 *   there (`up` finds nothing, so `jsonb_agg` is null and the function coalesces it to
 *   `[]`), and the panel renders that as "no history".
 *
 * The snake_case jsonb keys are mapped to the camelCase the console uses everywhere else,
 * so `TemplateStudio` never has to know which side of the wire a field came from.
 */
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { callStudioRpc } from '../../_shared';
import { uuidOr } from '@/src/server/template-studio/authoring';

type RouteContext = { params: Promise<{ templateId: string }> };

export async function GET(request: Request, ctx: RouteContext) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { templateId } = await ctx.params;
    const templateUuid = uuidOr(templateId);
    if (!templateUuid) {
      return errorResponse('templateId must be the UUID of a contest template.', 400, 'template_id_invalid');
    }

    const supabase = createAdminClient();
    const rpc = await callStudioRpc(
      supabase,
      'contest_template_versions',
      { p_template_id: templateUuid },
      '[admin/voting/contest-templates/versions GET]',
    );
    if (!rpc.ok) return rpc.response;

    const chain = Array.isArray(rpc.data?.chain) ? (rpc.data.chain as any[]) : [];
    return successResponse({
      success: true,
      versions: chain.map((entry) => ({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        status: entry.status,
        publishedAt: entry.published_at ?? null,
        createdAt: entry.created_at ?? null,
      })),
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load contest template versions');
  }
}
