// Minimal CSV export for admin tables (RFC 4180 quoting). Cells that a
// spreadsheet would evaluate as a formula are prefixed with ' (CSV injection).

export type CsvColumn<T> = { header: string; value: (row: T) => string | number | boolean | null | undefined };

function cell(v: string | number | boolean | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(','));
  return lines.join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Pages through a limit/offset endpoint until `total` rows (capped) are collected. */
export async function fetchAllPages<T>(
  fetchPage: (limit: number, offset: number) => Promise<{ items: T[]; total: number }>,
  { pageSize = 200, max = 5000 }: { pageSize?: number; max?: number } = {},
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < max; offset += pageSize) {
    const { items, total } = await fetchPage(pageSize, offset);
    out.push(...items);
    if (items.length < pageSize || out.length >= total) break;
  }
  return out.slice(0, max);
}
