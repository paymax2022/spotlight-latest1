// Pure-logic unit tests for multi-outlet selection.
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/outlets/*.spec.ts"
//
// The defect: the owner console read stores.data?.[0], so an owner with several
// outlets could only ever manage the first. 61 owners in the live data run 2–3.
// The console mutates menu prices, packaging fees and open/closed state, so
// resolving to the wrong outlet silently edits the wrong shop.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveActiveOutlet,
  sortOutlets,
  outletNameFor,
} from '@/features/restaurantmerchant/activeOutlet';

const o = (id: string, name: string, isOpen = true) => ({ id, name, isOpen });

describe('resolveActiveOutlet', () => {
  it('gives a single-outlet owner their outlet with no switcher', () => {
    const r = resolveActiveOutlet([o('r1', 'Mama Cass')]);
    assert.equal(r.active?.id, 'r1');
    assert.equal(r.multi, false);
  });

  it('flags multi-outlet owners so a switcher is shown', () => {
    const r = resolveActiveOutlet([o('r1', 'Ikeja'), o('r2', 'Lekki'), o('r3', 'Yaba')]);
    assert.equal(r.multi, true);
    assert.equal(r.outlets.length, 3);
  });

  it('honours the remembered outlet across sessions', () => {
    const r = resolveActiveOutlet([o('r1', 'Ikeja'), o('r2', 'Lekki')], 'r2');
    assert.equal(r.active?.id, 'r2');
  });

  it('falls back when the remembered outlet is no longer owned', () => {
    // Outlets get transferred, closed or removed. A stale id must not blank the
    // console — but it must also not silently resolve to a different shop while
    // the switcher still claims the old one.
    const r = resolveActiveOutlet([o('r1', 'Ikeja')], 'r-gone');
    assert.equal(r.active?.id, 'r1');
  });

  it('returns no outlet only when the owner truly has none', () => {
    assert.equal(resolveActiveOutlet([]).active, null);
    assert.equal(resolveActiveOutlet(undefined).active, null);
    assert.equal(resolveActiveOutlet(undefined).multi, false);
  });

  it('never picks an outlet the owner does not own', () => {
    const owned = [o('r1', 'Ikeja'), o('r2', 'Lekki')];
    for (const stale of ['r9', '', 'undefined']) {
      const r = resolveActiveOutlet(owned, stale);
      assert.ok(owned.some((x) => x.id === r.active?.id), `resolved to an unowned outlet for ${stale}`);
    }
  });
});

describe('sortOutlets', () => {
  it('puts trading outlets first, then alphabetical', () => {
    // Mid-service, the shops taking orders belong at the top.
    const sorted = sortOutlets([o('r1', 'Yaba', false), o('r2', 'Lekki', true), o('r3', 'Ikeja', false)]);
    assert.deepEqual(sorted.map((x) => x.name), ['Lekki', 'Ikeja', 'Yaba']);
  });

  it('does not mutate the input', () => {
    const input = [o('r1', 'B'), o('r2', 'A')];
    sortOutlets(input);
    assert.equal(input[0].name, 'B');
  });

  it('treats a missing isOpen as closed rather than throwing', () => {
    const sorted = sortOutlets([{ id: 'r1', name: 'NoFlag' }, o('r2', 'Open', true)]);
    assert.equal(sorted[0].name, 'Open');
  });
});

describe('outletNameFor', () => {
  it('labels an order with the outlet that owns it', () => {
    // The owner queue spans every outlet (ListOrders joins on owner_id), so a row
    // without an outlet name is unusable once you run more than one kitchen.
    const outlets = [o('r1', 'Ikeja'), o('r2', 'Lekki')];
    assert.equal(outletNameFor(outlets, 'r2'), 'Lekki');
  });

  it('returns null for an unknown or missing restaurant', () => {
    assert.equal(outletNameFor([o('r1', 'Ikeja')], 'r9'), null);
    assert.equal(outletNameFor([o('r1', 'Ikeja')], undefined), null);
    assert.equal(outletNameFor([], 'r1'), null);
  });
});
