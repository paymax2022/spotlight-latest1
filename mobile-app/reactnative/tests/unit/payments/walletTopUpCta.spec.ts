// A refused wallet debit must offer the way to fix it, not just name the problem.
//
// Before this change every shortfall surface said "Insufficient balance" and left
// the member to find the funding screen themselves — eight surfaces, five different
// names for the same dead end. The escape hatch is now one component
// (src/components/TopUpWalletButton.tsx) plus a dialog form for paths that only
// learn the refusal from a mutation callback (src/lib/walletTopUp.ts).
//
// What these tests pin, in the order the defect class actually happened here:
//   1. the component exists and its default destination is the NGN funding screen;
//   2. every surface that computes a shortfall renders it (a screen can regress to
//      prose-only without anyone noticing, which is what these screens were);
//   3. it points at the wallet that is ACTUALLY short — the invest wallet and the
//      FX currency wallet are not funded by /wallet/add;
//   4. it stays inside the shortfall condition, so a funded member is not told to
//      top up;
//   5. the dialog form asks before it navigates.
//
// Static-source assertions, matching this suite's convention (see
// tests/unit/payments/walletFundingCheckout.spec.ts): the app carries no component
// harness, and the routing target is the thing a later refactor is most likely to
// move.
//
//   npm run test:payments

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const button = read('src/components/TopUpWalletButton.tsx');
const dialog = read('src/lib/walletTopUp.ts');

/**
 * Every surface that refuses a debit for a short wallet, and the route that
 * actually funds it. `route` null means the surface uses the component's
 * default; `flag` is the name that screen computes for "too little money".
 */
const SURFACES: { file: string; flag: string; route: string | null }[] = [
  { file: 'app/invest/buy.tsx', flag: 'insufficient', route: '/invest/wallet' },
  { file: 'app/stocks/buy/index.tsx', flag: 'insufficient', route: '/invest/wallet' },
  { file: 'app/crypto/buy/index.tsx', flag: 'insufficient', route: '/invest/wallet' },
  { file: 'app/fx/convert/index.tsx', flag: 'insufficient', route: null },
  { file: 'app/fx/convert/failed.tsx', flag: 'insufficient', route: null },
  { file: 'app/services/telemedicine/book/confirm.tsx', flag: 'insufficient', route: null },
  { file: 'src/components/BillReviewSecurityPanel.tsx', flag: 'review.insufficient', route: null },
  { file: 'src/components/PaymentMethodSelector.tsx', flag: 'walletInsufficient', route: null },
];

test('the top-up pill exists and defaults to the NGN funding screen', () => {
  assert.match(button, /route = '\/wallet\/add'/);
  assert.match(button, /router\.push\(route\)/);
  assert.match(button, /accessibilityRole="button"/);
  assert.match(button, /accessibilityLabel=\{label\}/);
});

for (const surface of SURFACES) {
  test(`${surface.file} offers the escape hatch on a shortfall`, () => {
    const src = read(surface.file);
    assert.match(
      src,
      /import TopUpWalletButton from '@\/components\/TopUpWalletButton'/,
      'the screen must render the shared component, not its own link',
    );
    assert.match(src, /<TopUpWalletButton/, 'the refusal must carry the CTA');

    // The CTA has to live inside the shortfall branch. Grab the text just before
    // the first render and require this screen's own flag to be what gates it —
    // an unconditional pill would tell a funded member to add money.
    const at = src.indexOf('<TopUpWalletButton');
    const guard = src.slice(Math.max(0, at - 260), at);
    assert.ok(
      guard.includes(surface.flag),
      `${surface.file}: the pill is not gated by \`${surface.flag}\``,
    );
  });
}

for (const surface of SURFACES.filter((s) => s.route)) {
  test(`${surface.file} funds the wallet that is actually short`, () => {
    assert.match(read(surface.file), new RegExp(`route="${surface.route}"`));
  });
}

test('the FX screens branch on the source currency, not on a fixed route', () => {
  // /wallet/add is NGN-only; a USD or GBP wallet is funded by receiving into it.
  for (const file of ['app/fx/convert/index.tsx', 'app/fx/convert/failed.tsx']) {
    assert.match(
      read(file),
      /=== 'NGN' \? '\/wallet\/add' : '\/fx\/receive'/,
      `${file}: FX shortfall must not send a member to the NGN screen`,
    );
  }
});

test('the bills and telemedicine refusals use the default NGN destination', () => {
  for (const file of [
    'src/components/BillReviewSecurityPanel.tsx',
    'src/components/PaymentMethodSelector.tsx',
    'app/services/telemedicine/book/confirm.tsx',
  ]) {
    const at = read(file).indexOf('<TopUpWalletButton');
    assert.doesNotMatch(read(file).slice(at, at + 160), /route=/, `${file} overrides the route`);
  }
});

test('the dialog form asks before it navigates', () => {
  assert.match(dialog, /await confirmAsync\(\{/);
  assert.match(dialog, /confirmLabel: 'Top up wallet'/);
  assert.match(dialog, /if \(ok\) router\.push\('\/wallet\/add'\)/);
});
