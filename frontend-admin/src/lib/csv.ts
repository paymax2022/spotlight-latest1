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
