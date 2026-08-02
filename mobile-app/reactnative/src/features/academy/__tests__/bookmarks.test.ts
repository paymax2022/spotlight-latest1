// Pure-logic unit tests for bookmark list operations.
// Run: npm run test:academy
//
// Bug this supports: there was no addBookmark at all (only get/remove), and the
// transcript screen's bookmark toggle was local useState — nothing persisted, and
// nothing prevented duplicate bookmarks for the same lesson. upsertBookmark dedups
// by canonical href so tapping bookmark twice can't create duplicates.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { upsertBookmark, findBookmarkByHref } from '../bookmarks.ts';
import type { Bookmark } from '../types.ts';

const bm = (over: Partial<Bookmark>): Bookmark => ({
  id: 'b1', kind: 'lesson', title: 'Quadratics', subjectName: 'Mathematics',
  href: '/learn/academy/lesson/l1', ts: 't1', ...over,
});

test('adds a new bookmark, newest first', () => {
  const list = [bm({ id: 'b0', href: '/learn/academy/lesson/l0' })];
  const next = upsertBookmark(list, bm({ id: 'b1', href: '/learn/academy/lesson/l1' }));
  assert.equal(next.length, 2);
  assert.equal(next[0].id, 'b1', 'new bookmark is prepended');
});

test('dedups by href: re-bookmarking the same lesson replaces, never duplicates', () => {
  const list = [bm({ id: 'b1', href: '/learn/academy/lesson/l1', ts: 't1' })];
  const next = upsertBookmark(list, bm({ id: 'b2', href: '/learn/academy/lesson/l1', ts: 't2' }));
  assert.equal(next.length, 1, 'no duplicate for the same href');
  assert.equal(next[0].id, 'b2', 'newest wins');
});

test('findBookmarkByHref returns the match or undefined', () => {
  const list = [bm({ id: 'b1', href: '/learn/academy/lesson/l1' })];
  assert.equal(findBookmarkByHref(list, '/learn/academy/lesson/l1')?.id, 'b1');
  assert.equal(findBookmarkByHref(list, '/learn/academy/lesson/zzz'), undefined);
});

test('purity: input list is not mutated', () => {
  const list = [bm({ id: 'b1', href: '/learn/academy/lesson/l1' })];
  const snap = JSON.parse(JSON.stringify(list));
  upsertBookmark(list, bm({ id: 'b2', href: '/learn/academy/lesson/l2' }));
  assert.deepEqual(list, snap);
});
