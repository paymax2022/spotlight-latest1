// The events footer has four tabs in a fixed order. EVENTS_TAB_HREFS is the
// single source of that order, and every entry must be a real route file under
// app/events/, so renaming a route without updating the footer fails here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENTS_TAB_HREFS } from '@/features/events/tabs';

const APP_EVENTS = join(dirname(fileURLToPath(import.meta.url)), '../../../app/events');

// '/events' is app/events/index.tsx; '/events/x' is app/events/x.tsx or
// app/events/x/index.tsx.
function routeFileFor(href: string): string | null {
  const rel = href.replace(/^\/events\/?/, '');
  const candidates = rel === ''
    ? [join(APP_EVENTS, 'index.tsx')]
    : [join(APP_EVENTS, `${rel}.tsx`), join(APP_EVENTS, rel, 'index.tsx')];
  return candidates.find((c) => existsSync(c)) ?? null;
}

test('the footer tabs are exactly Following, Discover, My tickets, Organiser, in that order', () => {
  assert.deepEqual([...EVENTS_TAB_HREFS], ['/events/following', '/events', '/events/my-tickets', '/events/organiser']);
});

test('every tab href has a matching route file under app/events/', () => {
  for (const href of EVENTS_TAB_HREFS) {
    assert.notEqual(routeFileFor(href), null, `no route file for ${href}`);
  }
});
