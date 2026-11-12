// /services/food is the Food module's only nav entry (src/constants/modules.ts),
// yet it drew no footer: app/services/_layout.tsx mounts only the utility and
// transfer bars, and ModuleTabBar draws nothing unless the current path is one of
// its own tabs. So the screen that reserves paddingBottom for a footer left the
// user stranded — the way in and the way out were both a back gesture.
// Two halves are needed and either one alone still shows nothing: the route must
// be CLAIMED by a tab (so a tab lights up, not an unlit strip) and that bar must
// be MOUNTED by the layout that renders the route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleTab } from '@/components/ModuleTabBar';
import { UTILITY_TABS, TRANSFER_TABS, FOOD_TABS } from '@/constants/moduleTabs';

const RN = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVICES_LAYOUT = join(RN, 'app/services/_layout.tsx');

const ENTRY = '/services/food';

// Mirrors ModuleTabBar's own rule: a tab draws on its href or on any of its
// matchPaths, nothing else.
const claimedBy = (tabs: readonly ModuleTab[], path: string) =>
  tabs.find((t) => t.href === path || (t.matchPaths ?? []).includes(path)) ?? null;

const claimedPaths = (tabs: readonly ModuleTab[]) =>
  tabs.flatMap((t) => [t.href, ...(t.matchPaths ?? [])]);

test('the food entry route exists as a real screen file', () => {
  assert.ok(existsSync(join(RN, 'app/services/food.tsx')), `missing ${ENTRY}`);
});

test('the food bar claims the entry, so it draws with a tab lit', () => {
  const tab = claimedBy(FOOD_TABS, ENTRY);
  if (!tab) assert.fail(`${ENTRY} is claimed by no FOOD_TABS tab — bar stays hidden`);
  // Lit tab must be the discovery one: the entry screen IS discovery.
  assert.equal(tab.href, '/food');
});

test('no other services bar claims the food entry, so exactly one draws', () => {
  for (const [name, tabs] of [['UTILITY_TABS', UTILITY_TABS], ['TRANSFER_TABS', TRANSFER_TABS]] as const) {
    assert.equal(claimedBy(tabs, ENTRY), null, `${ENTRY} claimed by ${name} too — stacked footers`);
  }
});

test('the three services bars claim disjoint paths', () => {
  const sets = [UTILITY_TABS, TRANSFER_TABS, FOOD_TABS].map(claimedPaths);
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      assert.deepEqual(sets[i].filter((h) => sets[j].includes(h)), []);
    }
  }
});

test('the services layout mounts the food bar beside the other two', () => {
  const src = readFileSync(SERVICES_LAYOUT, 'utf8');
  assert.match(src, /<ModuleTabBar\s+tabs=\{FOOD_TABS\}/);
  assert.equal(
    (src.match(/<ModuleTabBar/g) ?? []).length,
    3,
    'expected exactly the utility, transfer and food bars',
  );
});
