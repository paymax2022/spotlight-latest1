// The services module mounts two ModuleTabBars side by side — the bill-paying
// one and the sending-money one. Each draws only when the current path is one
// of its own tabs, so the pair is safe *because* the sets are disjoint; the
// moment one href is added to both, the screen gets two stacked footers.
// A wrong href is worse than a missing button: the bar silently never shows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UTILITY_TABS, TRANSFER_TABS } from '@/constants/moduleTabs';

const APP_SERVICES = join(dirname(fileURLToPath(import.meta.url)), '../../../app/services');

// '/services/x' is app/services/x.tsx, or app/services/x/index.tsx for a folder
// route like transactions.
function routeFileFor(href: string): string | null {
  const rel = href.replace(/^\/services\/?/, '');
  const candidates = [join(APP_SERVICES, `${rel}.tsx`), join(APP_SERVICES, rel, 'index.tsx')];
  return candidates.find((c) => existsSync(c)) ?? null;
}

const hrefs = (tabs: readonly { href: string }[]) => tabs.map((t) => t.href);

test('every transfer tab href has a matching route file under app/services/', () => {
  for (const href of hrefs(TRANSFER_TABS)) {
    assert.notEqual(routeFileFor(href), null, `no route file for ${href}`);
  }
});

test('every utility tab href has a matching route file under app/services/', () => {
  for (const href of hrefs(UTILITY_TABS)) {
    assert.notEqual(routeFileFor(href), null, `no route file for ${href}`);
  }
});

test('the two services bars are disjoint, so only one can ever render', () => {
  const shared = hrefs(UTILITY_TABS).filter((h) => hrefs(TRANSFER_TABS).includes(h));
  assert.deepEqual(shared, []);
});

test('Send is a transfer tab, and transfer is not a seventh utility tab', () => {
  // Seven pills do not fit the 375pt width the utility bar was checked at.
  assert.ok(hrefs(TRANSFER_TABS).includes('/services/transfer'));
  assert.ok(!hrefs(UTILITY_TABS).includes('/services/transfer'));
  assert.equal(
    TRANSFER_TABS.find((t) => t.href === '/services/transfer')?.label,
    'Send',
  );
});

test('every tab label is one short word, and no href is duplicated within a bar', () => {
  for (const tabs of [UTILITY_TABS, TRANSFER_TABS]) {
    assert.equal(new Set(hrefs(tabs)).size, tabs.length);
    for (const tab of tabs) {
      assert.doesNotMatch(tab.label.trim(), /\s/, `${tab.href} label must be one word`);
    }
  }
});
