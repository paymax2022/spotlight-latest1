/**
 * Guard for the last link of the prize rail on the web plane.
 *
 * The console writes contests.prize_pool (the "Price to be won" field), GET
 * /api/v1/contests serves it as `prize`, and app/voting/page.tsx is the surface a
 * voter actually reads. That final hop has no runtime lane here: this package's
 * vitest runs in a node environment with no DOM and no testing-library, so a page
 * render cannot be executed. What can be pinned is the wiring that makes the row
 * appear — which matters precisely because every way it breaks is silent. A renamed
 * field, a mapper that drops the key, or an unguarded label all produce a page that
 * simply never mentions the prize, with no error anywhere in the stack.
 *
 * Tests 1 and 3 are the new behaviour. Test 2 already holds today and is pinned so a
 * later refactor of the loader cannot break it quietly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE = path.resolve(__dirname, '../../../app/voting/page.tsx');
const LIST_ROUTE = path.resolve(__dirname, '../../../app/api/v1/contests/route.ts');

const page = readFileSync(PAGE, 'utf8');
const listRoute = readFileSync(LIST_ROUTE, 'utf8');

describe('the /voting page shows the prize the console sets', () => {
  it('names the field the same on both sides of the boundary', () => {
    // The route emits `prize` off contests.prize_pool and the page's Contest shape
    // declares `prize`. Each file type-checks on its own, so a rename on either side
    // leaves the row permanently empty rather than failing a build.
    expect(listRoute).toMatch(/\bprize:\s*c\.prize_pool\b/);
    expect(page).toMatch(/\bprize\?:\s*string\s*;/);
  });

  it('takes the contests straight from the route, not a hand-picked copy', () => {
    // setContests(data) / setActiveContest(data[0]) pass the JSON through untouched,
    // which is why adding one field to the route was enough to make it reachable.
    expect(page).toContain("await fetch('/api/v1/contests')");
    expect(page).toContain('setContests(data)');
    expect(page).toContain('setActiveContest(data[0])');
  });

  it('renders the headline only when there is one', () => {
    // Older contests, and every contest whose admin left the box empty, send ''.
    // An unguarded row would print "Prize to be won:" on all of them, which reads as
    // a defect instead of "no prize set".
    expect(page).toMatch(/activeContest\.prize\s*\?/);
    expect(page).toContain('Prize to be won:');
    expect(page).toContain('<strong>{activeContest.prize}</strong>');
  });
});
