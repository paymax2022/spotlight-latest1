// Client-side CSV building + download for admin reporting views.

export type CsvValue = string | number | boolean | null | undefined;

/** RFC 4180 quoting, plus a leading-quote guard against spreadsheet formula injection. */
export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  const safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: CsvValue[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export type CsvColumn<T> = { header: string; value: (row: T) => CsvValue };

/** Column-definition variant of toCsv for typed row objects. */
export function toCsvColumns<T>(rows: T[], columns: CsvColumn<T>[]): string {
  return toCsv(
    columns.map((c) => c.header),
    rows.map((r) => columns.map((c) => c.value(r))),
  );
}

/** Naira column from integer kobo, fixed two decimals, no grouping separators. */
export const koboToNaira = (kobo: number | null | undefined): string => ((kobo ?? 0) / 100).toFixed(2);

export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
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
