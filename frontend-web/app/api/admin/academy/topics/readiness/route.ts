// Admin: export the evaluated readiness of every topic as CSV.
// Values come from the same listAdminTopics rows the console renders, so the
// spreadsheet cannot disagree with the publication gate. Permission:
// programs:manage.
import { NextResponse } from 'next/server';
import { errorResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { listAdminTopics, topicReadinessCsv } from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

export async function GET(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Topic learning is not available yet', 503);
    }
    await assertAdminPermission(request, 'programs:manage');
    const supabase = createAdminClient();
    // Page to exhaustion: a single 100-row page would silently truncate the
    // export the day the curriculum exceeds 100 topics.
    const rows: Parameters<typeof topicReadinessCsv>[0] = [];
    for (let page = 1; page <= 100; page += 1) {
      const result = await listAdminTopics(supabase, { page, pageSize: 100 });
      rows.push(...result.rows);
      if (result.rows.length === 0 || rows.length >= result.total) break;
    }
    const csv = topicReadinessCsv(rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="tmfa-topic-readiness.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return topicErrorResponse(error, 'Failed to export topic readiness');
  }
}
