import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import { listFraudAlerts } from '@/src/server/openmic/persistence';

function toCsv(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const esc = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => esc(row[h])).join(','));
  return lines.join('\n');
}

export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    assertOpenMicReadAdmin(request);
    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') || '').toLowerCase();
    const alerts = await listFraudAlerts(context.params.id);
    if (format === 'csv') {
      const csv = toCsv(
        alerts.map((row) => ({
          id: row.id,
          submissionId: row.submissionId,
          severity: row.severity,
          reason: row.reason,
          votesInEvent: row.votesInEvent,
          createdAt: row.createdAt,
        }))
      );
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="open-mic-${context.params.id}-fraud-alerts.csv"`,
        },
      });
    }
    return successResponse({
      success: true,
      alerts,
      total: alerts.length,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load fraud alerts');
  }
}
