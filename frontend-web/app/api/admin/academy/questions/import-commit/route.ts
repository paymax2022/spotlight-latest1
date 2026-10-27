// Admin: commit a CSV import as DRAFT items. Re-validates the CSV here rather than
// trusting anything from the preview, then runs the idempotent draft commit
// (unseen → insert; seen-draft-changed → update; approved/retired → never mutated).
// Import NEVER approves a question — every committed item is DRAFT until SME review.
// Permission: programs:manage.
import { createHash } from 'node:crypto';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import {
  checkHeaders, parseAndValidate, parseCsv, createImportBatch, commitDrafts,
} from '@/src/server/services/academy/assessment';

const PERMISSION = 'programs:manage';

export async function POST(request: Request) {
  try {
    if (!featureFlags.filmAcademyAssessment()) {
      return errorResponse('Assessments are not available yet', 503);
    }
    const identity = await assertAdminPermission(request, PERMISSION);
    const body = (await request.json().catch(() => null)) as { filename?: string; csv?: string } | null;
    const csv = typeof body?.csv === 'string' ? body.csv : '';
    if (!csv.trim()) return errorResponse('Provide the CSV text in `csv`', 400);
    const filename = String(body?.filename ?? 'upload.csv');

    const grid = parseCsv(csv);
    const header = checkHeaders(grid[0]);
    if (!header.ok) {
      return errorResponse(
        `CSV is missing required ${header.format === 'tmfa' ? 'TMFA pack' : 'question bank'} columns: ${header.missing.join(', ')}`,
        400,
      );
    }

    const report = parseAndValidate(csv);
    if (report.accepted.length === 0) {
      return errorResponse('No valid rows to import — every row was rejected', 422);
    }

    const supabase = createAdminClient();
    const sha256 = createHash('sha256').update(csv).digest('hex');
    const batchId = await createImportBatch(supabase, {
      filename,
      sourceSha256: sha256,
      report,
      committed: true,
      createdBy: uuidOrNull(identity.actorId),
    });

    const result = await commitDrafts(supabase, report.accepted, batchId);
    return successResponse({
      success: true,
      batchId,
      committed: result,
      rejected: report.rejected,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to commit the import');
  }
}

function uuidOrNull(v: string | null | undefined): string | null {
  return v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}
