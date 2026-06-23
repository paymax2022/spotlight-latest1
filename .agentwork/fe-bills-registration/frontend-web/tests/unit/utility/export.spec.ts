import { describe, expect, it } from 'vitest';
import { toCsv } from '@/src/server/utility/export';

describe('utility report CSV export', () => {
  it('serializes rows with headers', () => {
    const csv = toCsv([{ receipt: 'UTL-001', gross_profit_kobo: 5000 }]);
    expect(csv.split('\r\n')[0]).toBe('receipt,gross_profit_kobo');
  });

  it('escapes commas and quotes', () => {
    const csv = toCsv([{ provider: 'Provider, "A"' }]);
    expect(csv).toContain('"Provider, ""A"""');
  });
});
