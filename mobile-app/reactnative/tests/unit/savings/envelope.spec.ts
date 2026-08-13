// Pure-logic unit tests for the Go savings API response envelope.
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/savings/*.spec.ts"
// (node:test + assert — this app has no vitest; matches the other unit suites.)
//
// Every fixture below is the LITERAL shape emitted by
// backend/internal/savings/handler.go (line numbers in comments), so these
// tests fail if the client and the Go handler drift apart again.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  body,
  list,
  entity,
  summary,
  vaultDetail,
  circleDetail,
  targetDetail,
} from '@/features/savings/envelope';

/** Wrap a payload the way axios hands it to the callers. */
const res = (data: unknown) => ({ data });

describe('savings response envelope', () => {
  describe('the regression this guards', () => {
    it('an envelope is NOT an array — the bug that silently emptied every list', () => {
      // handler.go:85 — GET /vaults
      const payload = body(res({ success: true, vaults: [{ id: 'v1' }] }));
      assert.equal(Array.isArray(payload), false);
      // …which is why `(Array.isArray(raw) ? raw : [])` used to yield [] with no
      // error at all. list() is what makes the read work.
      assert.deepEqual(list(res({ success: true, vaults: [{ id: 'v1' }] }), 'vaults'), [{ id: 'v1' }]);
    });
  });

  describe('body()', () => {
    it('returns the envelope untouched so mutations can read balance_kobo off it', () => {
      // handler.go:114 — POST /vaults/:id/deposit
      assert.deepEqual(body(res({ success: true, balance_kobo: 250_000 })), {
        success: true,
        balance_kobo: 250_000,
      });
    });

    it('unwraps the optional { data } indirection', () => {
      assert.deepEqual(body(res({ data: { success: true, balance_kobo: 1 } })), {
        success: true,
        balance_kobo: 1,
      });
    });

    it('tolerates null/undefined payloads', () => {
      assert.equal(body(res(null)), null);
      assert.equal(body(res(undefined)), undefined);
    });
  });

  describe('list()', () => {
    it('extracts vaults (handler.go:85)', () => {
      const out = list(res({ success: true, vaults: [{ id: 'v1' }, { id: 'v2' }] }), 'vaults');
      assert.equal(out.length, 2);
      assert.equal(out[0].id, 'v1');
    });

    it('extracts circles for both list and discover (handler.go:360, :371)', () => {
      assert.equal(list(res({ success: true, circles: [{ id: 'c1' }] }), 'circles').length, 1);
    });

    it('extracts targets (handler.go:394)', () => {
      assert.equal(list(res({ success: true, targets: [{ id: 't1' }] }), 'targets').length, 1);
    });

    it('passes a bare array through, so a handler dropping the envelope still works', () => {
      assert.deepEqual(list(res([{ id: 'v1' }]), 'vaults'), [{ id: 'v1' }]);
    });

    it('yields [] for an empty result rather than throwing', () => {
      assert.deepEqual(list(res({ success: true, vaults: [] }), 'vaults'), []);
      assert.deepEqual(list(res({ success: true }), 'vaults'), []);
      assert.deepEqual(list(res(null), 'vaults'), []);
    });

    it('does not confuse one entity key for another', () => {
      assert.deepEqual(list(res({ success: true, circles: [{ id: 'c1' }] }), 'vaults'), []);
    });
  });

  describe('entity()', () => {
    it('extracts a created vault (handler.go:76)', () => {
      assert.deepEqual(entity(res({ success: true, vault: { id: 'v1', name: 'Rent' } }), 'vault'), {
        id: 'v1',
        name: 'Rent',
      });
    });

    it('extracts a created circle and target (handler.go:171, :249)', () => {
      assert.equal(entity(res({ success: true, circle: { id: 'c1' } }), 'circle').id, 'c1');
      assert.equal(entity(res({ success: true, target: { id: 't1' } }), 'target').id, 't1');
    });

    it('falls through to the body when the key is absent', () => {
      assert.deepEqual(entity(res({ id: 'v1' }), 'vault'), { id: 'v1' });
    });
  });

  describe('summary() — handler.go:318 { success, summary }', () => {
    it('maps the ledger-derived aggregate to camelCase', () => {
      const out = summary(res({
        success: true,
        summary: {
          vault_count: 3,
          vault_balance_kobo: 400_000,
          circle_count: 2,
          target_count: 1,
          target_balance_kobo: 100_000,
          total_saved_kobo: 500_000,
        },
      }));
      assert.deepEqual(out, {
        totalSavedKobo: 500_000,
        vaultCount: 3,
        circleCount: 2,
        targetCount: 1,
      });
    });

    it('defaults to zeros for a member with nothing saved', () => {
      assert.deepEqual(summary(res({ success: true, summary: {} })), {
        totalSavedKobo: 0,
        vaultCount: 0,
        circleCount: 0,
        targetCount: 0,
      });
    });
  });

  describe('vaultDetail() — handler.go:328 { success, vault, balance_kobo }', () => {
    it('folds the envelope balance into the vault (the only source of one)', () => {
      const out = vaultDetail(res({ success: true, vault: { id: 'v1', name: 'Rent' }, balance_kobo: 500_000 }));
      assert.equal(out.id, 'v1');
      assert.equal(out.balance_kobo, 500_000);
    });

    it('keeps a zero balance rather than falling back — 0 is a real amount', () => {
      const out = vaultDetail(res({ success: true, vault: { id: 'v1', balance_kobo: 999 }, balance_kobo: 0 }));
      assert.equal(out.balance_kobo, 0);
    });
  });

  describe('circleDetail() — handler.go:209 { success, circle, members }', () => {
    it('folds members into the circle where circleFromBackend looks for them', () => {
      const out = circleDetail(res({
        success: true,
        circle: { id: 'c1', name: 'Ajo', contribution_kobo: 100_000 },
        members: [{ id: 'm1' }, { id: 'm2' }],
      }));
      assert.equal(out.id, 'c1');
      assert.equal(out.members.length, 2);
    });

    it('returns the body unchanged when there is no circle key', () => {
      assert.deepEqual(circleDetail(res({ id: 'c1' })), { id: 'c1' });
    });
  });

  describe('targetDetail() — handler.go:415 { success, target, members, balance_kobo }', () => {
    it('maps balance_kobo to saved_kobo: the Go GroupTarget carries no saved amount', () => {
      const out = targetDetail(res({
        success: true,
        target: { id: 't1', name: 'Trip', target_kobo: 1_000_000 },
        members: [{ id: 'm1' }],
        balance_kobo: 350_000,
      }));
      assert.equal(out.id, 't1');
      assert.equal(out.saved_kobo, 350_000);
      assert.equal(out.contributors.length, 1);
    });

    it('keeps a zero saved amount rather than falling back', () => {
      const out = targetDetail(res({ success: true, target: { id: 't1', saved_kobo: 999 }, balance_kobo: 0 }));
      assert.equal(out.saved_kobo, 0);
    });
  });
});
