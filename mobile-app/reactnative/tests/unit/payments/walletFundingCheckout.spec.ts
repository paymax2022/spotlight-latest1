// /wallet/add's "Continue to Paystack" must fund the wallet INSIDE the in-app
// Paystack SDK and come back to the top-up status screen.
//
// The defect these tests pin: the fund path took the server's authorization_url
// to the external browser, so the Expo web build navigated the whole app to
// https://checkout.paystack.com/<access code> (same tab, no way back to the
// wallet) and the native build left for the browser app. The in-app wiring
// existed (554bee93e) and was lost to a wip/backup-* merge; #227 had already
// removed the external hand-off from every other screen, so this was the last
// one. Verified live on 2026-11-12: tapping the CTA at :8083/wallet/add landed on
// checkout.paystack.com with an access code that resumesTransaction() accepts.
//
// Static-source assertions, matching this suite's convention (see
// tests/unit/voting/liveEndpoints.spec.ts): the screen has no DI seam and the app
// carries no component harness, so the pin is the wiring itself.
//
//   npm run test:payments

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const screen = read('src/components/PaymentActionScreen.tsx');

/** Everything the fund button does, from its hook to the mutation next to it. */
const fundRegion = (src: string) =>
  src.slice(src.indexOf('useGatewayCheckout'), src.indexOf('const resolveMutation'));

test('funding resumes the server-initialized transaction in the in-app gateway', () => {
  assert.match(screen, /import \{[^}]*useGatewayCheckout[^}]*\} from '@\/features\/payments'/);
  assert.match(screen, /fundCheckout\.start\(\{/);
  assert.match(screen, /domain: 'wallet_topup'/);
});

test('the Paystack authorization URL is never handed to the external browser', () => {
  assert.doesNotMatch(screen, /\bLinking\b/);
});

test('the server-initialized result is what the gateway resumes', () => {
  const region = fundRegion(screen);
  // initiateFunding's field is kobo and posts straight through as amount_kobo —
  // naming it `amount` has already produced a 100x under-top-up once.
  assert.match(region, /initiateFunding\(\{ amountKobo:/);
  assert.doesNotMatch(region, /initiateFunding\(\{ amount:/);
});

test('a completed checkout lands on the top-up status screen', () => {
  // The webhook credits the wallet asynchronously, so the return screen has to
  // poll it; a route that does not exist would dead-end the user instead.
  const status = read('app/wallet/topup/[reference].tsx');
  assert.match(status, /getTopupStatus/);
  assert.match(fundRegion(screen), /router\.replace\(`\/wallet\/topup\/\$\{/);
});

test('the checkout WebView host is mounted, or native renders no sheet', () => {
  assert.match(screen, /<fundCheckout\.Sheet\s*\/>/);
});

test('the Tier 1 KYC gate still stands in front of funding', () => {
  const start = screen.slice(screen.indexOf('const startFunding'), screen.indexOf('const handlePrimary'));
  assert.match(start, /await kycStepUp\.check\(\)/);
  assert.match(start, /promptKycForFunding\(\)/);
  // A degraded tier lookup lets the request through, so the server's own 403 gate
  // has to read as the same KYC prompt rather than as a raw error.
  assert.match(fundRegion(screen), /kyc tier/i);
  assert.match(fundRegion(screen), /promptKycForFunding/);
});
