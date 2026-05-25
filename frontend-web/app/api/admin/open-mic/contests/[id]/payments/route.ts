import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import { listPaymentEvents } from '@/src/server/openmic/persistence';

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
    const events = await listPaymentEvents(context.params.id);
    if (format === 'csv') {
      const csv = toCsv(
        events.map((row) => ({
          id: row.id,
          eventType: row.eventType,
          amountNgn: row.amountNgn,
          paymentStatus: row.paymentStatus,
          paymentReference: row.paymentReference || '',
          provider: row.provider || '',
          createdAt: row.createdAt,
        }))
      );
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="open-mic-${context.params.id}-payments.csv"`,
        },
      });
    }
    return successResponse({
      success: true,
      events,
      total: events.length,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load payment events');
  }
}
