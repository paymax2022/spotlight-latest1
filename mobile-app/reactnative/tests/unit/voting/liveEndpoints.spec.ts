// UAT Batch 2 (TS-13, Mobile App Screens): proves the LIVE (non-mock) branch of
// each screen's data layer calls the real backend at the right path with the
// right shape, now that Batch 1 landed the paid-vote/free-vote/visibility
// fixes on the backend (PR #164, commit 978ef4c0). Static-source assertions,
// matching this suite's existing convention (see paidVoting.spec.ts) rather
// than a mocked-axios integration test, since the module has no DI seam for
// the `api` client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const apiSrc = readFileSync(
  join(process.cwd(), 'src/features/voting/api/voting.api.ts'),
  'utf8',
);

// ---------------------------------------------------------------------------
// Mock is opt-in, not default — MB-001/002/005/006 all depend on this.
test('voting mock is opt-in only (live by default)', () => {
  assert.match(apiSrc, /mockAllowed\(process\.env\.EXPO_PUBLIC_VOTING_USE_MOCK,\s*false\)/);
});

// ---------------------------------------------------------------------------
// MB-001: Contest discovery/list & detail.
test('getContests hits the real Connect contests endpoint when live', () => {
  const fn = apiSrc.slice(apiSrc.indexOf('export async function getContests'));
  assert.match(fn, /api\.get\(`\$\{CONNECT_VOTING_BASE\}\/contests`, \{ params \}\)/);
});

test('getContest falls back to a roster-derived count/vote total rather than failing', () => {
  const fn = apiSrc.slice(
    apiSrc.indexOf('export async function getContest('),
    apiSrc.indexOf('// ─── Contestants'),
  );
  assert.match(fn, /api\.get\(`\$\{CONNECT_VOTING_BASE\}\/contests\/\$\{contestId\}`\)/);
  assert.match(fn, /catch \{/, 'roster failure must not fail the whole contest-detail fetch');
});

// ---------------------------------------------------------------------------
// MB-005: contestant profile (free + paid options).
test('getContestants and getContestant read the live roster', () => {
  assert.match(
    apiSrc,
    /api\.get\(`\$\{CONNECT_VOTING_BASE\}\/contests\/\$\{contestId\}\/contestants`, \{ params \}\)/,
  );
  assert.match(
    apiSrc,
    /api\.get\(`\$\{CONNECT_VOTING_BASE\}\/contestants\/\$\{contestantId\}`\)/,
  );
});

// ---------------------------------------------------------------------------
// MB-006: free vote action + daily-limit state — the most important row.
//
// Mobile's free vote does NOT go through the same engine as web's fixed path.
// Web (`frontend-web/components/voting/VoteModal.tsx`) calls the v2 bridge
// `/api/v2/votes/free`, whose atomic `claim_free_vote` RPC got the D-001 (TZ)
// and D-002 (race) fixes. Mobile calls the SEPARATE Go Connect voting engine
// (`backend/internal/connect/voting`) via `/api/v1/connect/contests/:id/vote`
// — confirmed below. That engine's own `Service.FreeVote`
// (backend/internal/connect/voting/service.go:191-234) still does a plain
// check-then-act: `CountFreeVotes` (read) then `InsertVote` (write), no row
// lock, no unique constraint on connect_votes for (contest_id, voter_id,
// option_ref, date), and the handler does not require an Idempotency-Key
// (`FreeVote` — "No money" comment at handlers.go:80). That is the same class
// of race as D-002, just unfixed on this engine. This is a BACKEND Go fix,
// out of scope for this mobile batch — flagged, not fixed here.
test('mobile free-vote calls the Connect engine, not the fixed v2 bridge', () => {
  const fn = apiSrc.slice(
    apiSrc.indexOf('export async function castFreeVotes'),
    apiSrc.indexOf('// ─── Paid Vote Initiate'),
  );
  assert.match(
    fn,
    /api\.post\(\s*`\$\{CONNECT_VOTING_BASE\}\/contests\/\$\{payload\.contestId\}\/vote`/,
  );
  assert.doesNotMatch(
    fn,
    /\/api\/v2\/votes\/free/,
    'mobile free-vote still targets the unfixed Connect engine, not the v2 bridge — if this ever ' +
      'starts matching, re-check whether the D-001/D-002 fixes now cover the mobile path too',
  );
  // optionRef is the contract the Connect FreeVoteRequest binds to
  // (backend/internal/connect/voting/models.go) — a drift here 400s silently.
  assert.match(fn, /\{\s*optionRef:\s*payload\.contestantId\s*\}/);
  // Server-reported remaining allowance is trusted over any client-side count.
  assert.match(fn, /res\.data\?\.allowance/);
});

test('getFreeVoteAllocation reads the live per-contest allowance, not a client guess', () => {
  const fn = apiSrc.slice(
    apiSrc.indexOf('export async function getFreeVoteAllocation'),
    apiSrc.indexOf('// ─── Cast Free Votes'),
  );
  assert.match(fn, /\$\{CONNECT_VOTING_BASE\}\/contests\/\$\{contestId\}\/free-vote-allowance/);
});

// ---------------------------------------------------------------------------
// MB-007: paid vote purchase flow.
//
// CONTEST-002 found the v2 initiate route broken; the client must still POST
// the OLD /api/votes/paid/initiate route for card/Paystack purchases, while
// verify must use the newly-fixed v2 route (PV-005, closes the double-credit
// race). A regression here either reopens PV-005 (verify reverts to v1) or
// re-breaks every non-wallet paid vote (initiate moves to the broken v2 route).
test('paid-vote initiate (non-wallet) still targets the OLD, working route', () => {
  const fn = apiSrc.slice(
    apiSrc.indexOf('export async function initiatePaidVote'),
    apiSrc.indexOf('export async function verifyPaidVote'),
  );
  assert.match(fn, /api\.post\(\s*'\/api\/votes\/paid\/initiate'/);
  assert.doesNotMatch(
    fn.slice(fn.indexOf("payload.paymentMethod === 'WALLET'") + 1, fn.length),
    /\/api\/v2\/votes\/paid\/initiate/,
    'the v2 initiate route is confirmed broken (CONTEST-002) — do not cut over',
  );
});

test('paid-vote verify uses the v2 route that closes the double-credit race', () => {
  const fn = apiSrc.slice(apiSrc.indexOf('export async function verifyPaidVote'));
  assert.match(fn, /api\.post\('\/api\/v2\/votes\/paid\/verify'/);
  assert.match(fn, /transactionId:\s*args\.transactionId/);
  assert.match(fn, /paymentReference:\s*args\.reference/);
});

test('the wallet paid-vote rail is idempotency-keyed', () => {
  const fn = apiSrc.slice(
    apiSrc.indexOf('export async function initiatePaidVote'),
    apiSrc.indexOf('export async function verifyPaidVote'),
  );
  const walletBranch = fn.slice(fn.indexOf("paymentMethod === 'WALLET'"));
  assert.match(walletBranch, /'\/api\/votes\/paid\/wallet'/);
  assert.match(walletBranch, /'Idempotency-Key':\s*payload\.idempotencyKey/);
});

// ---------------------------------------------------------------------------
// MB-008: leaderboard respects hidden state from the LIVE response, not just
// the contest's boolean flag (EC-008 leak fix must actually be read).
test('getLeaderboardState surfaces the live hidden/{entries:[]} shape', () => {
  const fn = apiSrc.slice(
    apiSrc.indexOf('export async function getLeaderboardState'),
    apiSrc.indexOf('export async function getLeaderboard('),
  );
  assert.match(fn, /\$\{CONNECT_VOTING_BASE\}\/contests\/\$\{contestId\}\/contestants/);
  assert.match(fn, /body\?\.hidden/);
  assert.match(fn, /hidden:\s*true,\s*\n\s*reason:\s*body\.reason/);
});

test('leaderboard screen checks the live hidden flag, not only the contest flag', () => {
  const screenSrc = readFileSync(join(process.cwd(), 'app/voting/leaderboard.tsx'), 'utf8');
  assert.match(
    screenSrc,
    /lbState\?\.hidden === true \|\| contest\?\.showLeaderboard === false/,
    'must OR the live leaderboard-state response with the contest flag — either alone can be stale',
  );
});

// ---------------------------------------------------------------------------
// MB-012: notifications center — read-only against live, derived data.
test('getVotingNotifications reads the live derived feed', () => {
  const fn = apiSrc.slice(apiSrc.indexOf('export async function getVotingNotifications'));
  assert.match(fn, /api\.get\('\/api\/v1\/connect\/notifications'\)/);
  // Derived feed: server always reports read:true (see comment above the fn) —
  // the client must pass that through rather than inventing unread state.
  assert.match(fn, /read:\s*r\.read/);
});

test('notifications screen has no mark-as-read mutation (net-new — flagged, not built)', () => {
  const screenSrc = readFileSync(join(process.cwd(), 'app/voting/notifications.tsx'), 'utf8');
  assert.doesNotMatch(
    screenSrc,
    /markAsRead|mark_as_read|PATCH.*notifications/i,
    'if this starts matching, update the TS-13 MB-012 test-plan note — mark-as-read was built',
  );
});

// ---------------------------------------------------------------------------
// MB-014: a fetch failure must render as an error, not silently fall into the
// "no data yet" empty state (fixed in this batch for the list + gallery).
test('contest list and contestant gallery render a real error state, not just empty', () => {
  for (const file of ['app/voting/contests.tsx', 'app/voting/contestants.tsx']) {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    assert.match(src, /isError/, `${file} must destructure isError from its query hook`);
    assert.match(src, /Could not load/, `${file} must render a distinct could-not-load message`);
  }
});

// ---------------------------------------------------------------------------
// MB-002: registration wizard posts to the real endpoints when live.
test('registration API is opt-in mock, live endpoints match the documented contract', () => {
  const regSrc = readFileSync(
    join(process.cwd(), 'src/features/registration/api/registration.api.ts'),
    'utf8',
  );
  assert.match(regSrc, /REG_BASE = '\/api\/registration'/);
  assert.match(regSrc, /regPost<DraftResponse>\(`\$\{REG_BASE\}\/applications`, \{ contestSlug \}\)/);
  assert.match(regSrc, /regPatch<SaveStepResponse>\(`\$\{REG_BASE\}\/applications\/\$\{params\.id\}`/);
  assert.match(regSrc, /regPost<SubmitResponse>\(`\$\{REG_BASE\}\/applications\/\$\{id\}\/submit`\)/);
});
