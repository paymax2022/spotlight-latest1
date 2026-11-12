import { describe, it, expect } from 'vitest';
import { NAV_TREE } from './AdminSidebar';

// The flat menu rendered only the sections named in a hand-kept list, and
// 'Invest (Stocks)' was missing from it — 9 built screens no operator could
// reach from the navigation. The tree builder files anything it cannot place
// under 'Unfiled', so a nav item added without being filed is loud here instead
// of silently absent from the sidebar.

const allHrefs = NAV_TREE.flatMap((d) => d.modules.flatMap((m) => m.items.map((i) => i.href)));

describe('admin navigation tree', () => {
  it('files every nav item into a real domain', () => {
    expect(NAV_TREE.filter((d) => d.label === 'Unfiled')).toEqual([]);
  });

  it('lists every screen exactly once', () => {
    expect(new Set(allHrefs).size).toBe(allHrefs.length);
    expect(allHrefs.length).toBeGreaterThan(400);
  });

  it('never renders an empty domain or sub-group', () => {
    for (const domain of NAV_TREE) {
      expect(domain.modules.length, domain.label).toBeGreaterThan(0);
      for (const module of domain.modules) {
        expect(module.items.length, `${domain.label} > ${module.label}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the stock screens reachable from Financial Products', () => {
    const invest = NAV_TREE.find((d) => d.label === 'Financial Products')!;
    expect(invest.modules.flatMap((m) => m.items.map((i) => i.href)).filter((h) => h.startsWith('/admin/invest'))).toHaveLength(9);
  });

  it('groups sub-screens under the module their URLs already form', () => {
    const health = NAV_TREE.find((d) => d.label === 'Health')!;
    const labels = health.modules.map((m) => m.label);
    expect(labels).toEqual(expect.arrayContaining(['Pharmacy', 'Laboratory', 'Veterinary', 'Telemedicine']));
    const pharmacy = health.modules.find((m) => m.label === 'Pharmacy')!;
    expect(pharmacy.items.every((i) => i.href.startsWith('/admin/health/'))).toBe(true);
  });
});
