// "Recent Billers" on the Bills hub are derived from the user's REAL utility purchases, so
// any provider that gets bought from appears — with its own logo — instead of a hard-coded
// demo list. This is the pure derivation: newest successful purchase per provider + number.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRecentBillers, maskIdentifier, logoCategory } from '@/features/services/recentBillers';
import type { Transaction } from '@/types/transaction';

let n = 0;
const tx = (over: Partial<Transaction>): Transaction => ({
  id: `t${++n}`, serviceType: 'AIRTIME', status: 'SUCCESSFUL', amount: 100000, charges: 0, totalAmount: 100000,
  reference: `R${n}`, customerIdentifier: '08031112241', createdAt: `2026-10-${String(10 + n).padStart(2, '0')}T10:00:00Z`,
  ...over,
});

describe('maskIdentifier', () => {
  it('keeps the first 4 and last 3 digits', () => {
    assert.equal(maskIdentifier('08031112241'), '0803•••241');
  });
  it('ignores spaces and leaves short values alone', () => {
    assert.equal(maskIdentifier('0421 0000 918'), '0421•••918');
    assert.equal(maskIdentifier('1234'), '1234');
  });
});

describe('logoCategory', () => {
  it('maps every service type to the billing API category', () => {
    assert.equal(logoCategory('AIRTIME'), 'airtime');
    assert.equal(logoCategory('DATA'), 'data');
    assert.equal(logoCategory('ELECTRICITY'), 'electricity');
    assert.equal(logoCategory('CABLE_TV'), 'cable_tv');
    assert.equal(logoCategory('EDUCATION'), 'education');
  });
});

describe('deriveRecentBillers', () => {
  it('lists only successful purchases', () => {
    const rows = deriveRecentBillers([
      tx({ providerName: 'MTN', status: 'FAILED' }),
      tx({ providerName: 'Airtel', status: 'PENDING' }),
      tx({ providerName: 'Glo', status: 'SUCCESSFUL' }),
    ]);
    assert.deepEqual(rows.map((r) => r.providerName), ['Glo']);
  });

  it('is newest first, whatever order the input arrives in', () => {
    const a = tx({ providerName: 'MTN', createdAt: '2026-10-01T00:00:00Z', customerIdentifier: '08030000001' });
    const b = tx({ providerName: 'Airtel', createdAt: '2026-10-09T00:00:00Z', customerIdentifier: '08020000002' });
    assert.deepEqual(deriveRecentBillers([a, b]).map((r) => r.providerName), ['Airtel', 'MTN']);
  });

  it('collapses repeat purchases of the same provider and number into the latest one', () => {
    const old = tx({ providerName: 'MTN', amount: 50000, createdAt: '2026-10-01T00:00:00Z' });
    const recent = tx({ providerName: 'MTN', amount: 200000, createdAt: '2026-10-09T00:00:00Z' });
    const rows = deriveRecentBillers([old, recent]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amountKobo, 200000);
    assert.equal(rows[0].id, recent.id);
  });

  it('keeps different numbers or different services for the same provider apart', () => {
    const rows = deriveRecentBillers([
      tx({ providerName: 'MTN', customerIdentifier: '08030000001' }),
      tx({ providerName: 'MTN', customerIdentifier: '08030000002' }),
      tx({ providerName: 'MTN', serviceType: 'DATA', customerIdentifier: '08030000001' }),
    ]);
    assert.equal(rows.length, 3);
  });

  it('works for ANY provider name, not a fixed list', () => {
    const rows = deriveRecentBillers([
      tx({ serviceType: 'ELECTRICITY', providerName: 'Kaduna Electric', customerIdentifier: '04210000918', productName: 'Prepaid' }),
      tx({ serviceType: 'CABLE_TV', providerName: 'StarTimes', customerIdentifier: '70200000903', productName: 'Nova' }),
      tx({ serviceType: 'EDUCATION', providerName: 'WAEC', customerIdentifier: '5551112222' }),
    ]);
    assert.deepEqual(rows.map((r) => r.providerName).sort(), ['Kaduna Electric', 'StarTimes', 'WAEC']);
  });

  it('titles and subtitles read naturally per service', () => {
    const [air, elec, cable] = deriveRecentBillers([
      tx({ serviceType: 'AIRTIME', providerName: 'MTN', customerIdentifier: '08031112241', createdAt: '2026-10-30T00:00:00Z' }),
      tx({ serviceType: 'ELECTRICITY', providerName: 'Eko Electric', customerIdentifier: '04210000918', productName: 'Prepaid', createdAt: '2026-10-29T00:00:00Z' }),
      tx({ serviceType: 'CABLE_TV', providerName: 'DSTV', customerIdentifier: '70200000903', productName: 'DSTV Compact', createdAt: '2026-10-28T00:00:00Z' }),
    ]);
    assert.equal(air.title, 'MTN Airtime');
    assert.equal(air.subtitle, '0803•••241');
    assert.equal(elec.title, 'Eko Electric Prepaid');
    assert.equal(elec.subtitle, 'Meter 0421•••918');
    // The product name already says the provider: do not print "DSTV DSTV Compact".
    assert.equal(cable.title, 'DSTV Compact');
    assert.equal(cable.subtitle, 'Smartcard 7020•••903');
  });

  it('falls back to the service label when the provider is unknown, and carries no provider name', () => {
    const [row] = deriveRecentBillers([tx({ serviceType: 'ELECTRICITY', providerName: undefined, customerIdentifier: '04210000918' })]);
    assert.equal(row.providerName, null);
    assert.equal(row.title, 'Electricity');
  });

  it('caps the list', () => {
    const many = Array.from({ length: 12 }, (_, i) => tx({ providerName: `P${i}`, customerIdentifier: `0803000${String(i).padStart(4, '0')}` }));
    assert.equal(deriveRecentBillers(many).length, 5);
    assert.equal(deriveRecentBillers(many, 3).length, 3);
  });

  it('is empty for no purchases', () => {
    assert.deepEqual(deriveRecentBillers([]), []);
  });
});
