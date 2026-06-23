import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import { listNotifications } from '@/src/server/openmic/persistence';

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
    await assertOpenMicReadAdmin(request);
    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') || '').toLowerCase();
    const notifications = await listNotifications(context.params.id);
    if (format === 'csv') {
      const csv = toCsv(
        notifications.map((row) => ({
          id: row.id,
          audience: row.audience,
          channel: row.channel,
          eventKey: row.eventKey,
          title: row.title,
          message: row.message,
          status: row.status,
          createdAt: row.createdAt,
        }))
      );
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="open-mic-${context.params.id}-notifications.csv"`,
        },
      });
    }
    return successResponse({
      success: true,
      notifications,
      total: notifications.length,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load notifications');
  }
}
