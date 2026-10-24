// Admin: preview a CSV import WITHOUT touching the bank. Runs the pure validator
// and records an uncommitted import batch (counters + row diagnostics only) so the
// console can show exactly what a commit would do. Nothing becomes exam-eligible
// here — even a "good" row lands as DRAFT only on commit, and only SME review can
// promote it. Permission: programs:manage.
import { createHash } from 'node:crypto';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { checkHeaders, parseAndValidate, parseCsv, createImportBatch } from '@/src/server/services/academy/assessment';

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
      return errorResponse(`CSV is missing required columns: ${header.missing.join(', ')}`, 400);
    }

    const report = parseAndValidate(csv);
    const supabase = createAdminClient();
    const sha256 = createHash('sha256').update(csv).digest('hex');
    const batchId = await createImportBatch(supabase, {
      filename,
      sourceSha256: sha256,
      report,
      committed: false,
      createdBy: uuidOrNull(identity.actorId),
    });

    return successResponse({
      success: true,
      preview: true,
      batchId,
      totals: {
        rows: report.totalRows,
        accepted: report.accepted.length,
        rejected: report.rejected.length,
        warned: report.warned.length,
      },
      rejected: report.rejected,
      warned: report.warned.slice(0, 50),
    });
  } catch (error) {
    return handleApiError(error, 'Failed to preview the import');
  }
}

function uuidOrNull(v: string | null | undefined): string | null {
  return v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}
