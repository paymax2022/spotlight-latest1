import { describe, expect, it } from 'vitest';
import { fetchAllPages, toCsv } from './csv';

describe('toCsv', () => {
  it('quotes separators and neutralises formula cells', () => {
    const csv = toCsv([{ a: 'x,"y"', b: '=SUM(A1)', c: null }], [
      { header: 'a', value: (r) => r.a },
      { header: 'b', value: (r) => r.b },
      { header: 'c', value: (r) => r.c },
    ]);
    expect(csv).toBe('a,b,c\r\n"x,""y""",\'=SUM(A1),');
  });
});

describe('fetchAllPages', () => {
  it('stops at total and respects the cap', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => i);
    const page = async (limit: number, offset: number) => ({ items: rows.slice(offset, offset + limit), total: rows.length });
    expect(await fetchAllPages(page)).toHaveLength(450);
    expect(await fetchAllPages(page, { max: 300 })).toHaveLength(300);
  });
});
