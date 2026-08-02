// Pure-logic unit tests for competition leaderboard ranking.
// Run: npm run test:academy-fees  (node --test with the ts-path resolver)
//
// The bug this pins: the leaderboard was a static array — the viewer's row score
// was hardcoded and never reflected their earned points, and the board never
// re-ranked, so playing a challenge changed the profile's totalPoints but not the
// viewer's position. Ranking was cosmetic. rankByScore makes the viewer's score
// the single source of truth and recomputes 1..N ranks.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rankByScore, viewerRank } from '../leaderboardRanking.ts';

type Row = { rank: number; score: number; isMe: boolean; name: string };
const board: Row[] = [
  { rank: 1, score: 9820, isMe: false, name: 'Chidi' },
  { rank: 2, score: 9540, isMe: false, name: 'Fatima' },
  { rank: 3, score: 9310, isMe: false, name: 'Tobi' },
  { rank: 6, score: 8510, isMe: true,  name: 'Me' },
  { rank: 7, score: 8340, isMe: false, name: 'Kunle' },
];

test('viewer row score is replaced by the live viewer score (single source of truth)', () => {
  const ranked = rankByScore(board, 9600);
  const me = ranked.find((r) => r.isMe)!;
  assert.equal(me.score, 9600);
});

test('re-ranks by score desc with contiguous 1..N ranks', () => {
  const ranked = rankByScore(board, 8510);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3, 4, 5]);
  // sorted descending by score
  const scores = ranked.map((r) => r.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('earning points moves the viewer UP the board', () => {
  const before = viewerRank(rankByScore(board, 8510)); // between Tobi(9310) and Kunle(8340) → rank 4
  const after = viewerRank(rankByScore(board, 9600));   // above Fatima(9540) → rank 2
  assert.equal(before, 4);
  assert.equal(after, 2);
  assert.ok(after < before, 'more points ⇒ better (lower) rank number');
});

test('losing ground moves the viewer DOWN', () => {
  const r = viewerRank(rankByScore(board, 1)); // below everyone → last
  assert.equal(r, board.length);
});

test('viewerRank returns undefined when no isMe row', () => {
  const noMe = board.map((r) => ({ ...r, isMe: false }));
  assert.equal(viewerRank(rankByScore(noMe, 9999)), undefined);
});

test('ties are broken deterministically (stable input order preserved)', () => {
  const tie: Row[] = [
    { rank: 1, score: 500, isMe: false, name: 'A' },
    { rank: 2, score: 500, isMe: false, name: 'B' },
    { rank: 3, score: 500, isMe: true,  name: 'Me' },
  ];
  const ranked = rankByScore(tie, 500);
  assert.deepEqual(ranked.map((r) => r.name), ['A', 'B', 'Me']);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
});

test('purity: input array + rows are not mutated', () => {
  const snapshot = JSON.parse(JSON.stringify(board));
  rankByScore(board, 42);
  assert.deepEqual(board, snapshot);
});
