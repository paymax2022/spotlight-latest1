// The registration fee card rail must pay INSIDE the in-app Paystack SDK.
//
// Found on 2026-11-12 while verifying the native `Sheet` path for the wallet
// fix: `app/registration/[id]/payment.tsx` still took the server's
// authorization_url to `Linking.openURL`, which leaves the app for
// https://checkout.paystack.com/<access code>. The mobile screen posts the
// initiate without `inline`, so frontend-web runs a server-side
// transaction/initialize and hands back that hosted URL — while the two web
// wizards (ContestRegistrationWizard, RealityTvShowApplicationWizard) send
// `inline: true` and never leave the page, and every other mobile card payment
// resumes the server-minted access code in-app through useGatewayCheckout.
//
// Static-source assertions, matching tests/unit/payments/walletFundingCheckout.spec.ts:
// this screen has no DI seam and the app carries no component harness.
//
//   npm run test:payments

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const screen = read('app/registration/[id]/payment.tsx');

/** Every source file under `relDir`, as cwd-relative paths. */
function screensUnder(relDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(process.cwd(), relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...screensUnder(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

test('the registration card rail runs the in-app gateway plane', () => {
  assert.match(screen, /import \{[^}]*useGatewayCheckout[^}]*\} from '@\/features\/payments'/);
  assert.match(screen, /checkout\.start\(\{/);
  assert.match(screen, /domain: 'registration_payment'/);
});

test('this screen no longer touches the external browser at all', () => {
  assert.doesNotMatch(screen, /\bLinking\b/);
});

test('no paid flow in the app hands an authorization URL to the browser', () => {
  // Regression guard for the whole defect class, over screens AND shared
  // components: the wallet hand-off lived in src/components/PaymentActionScreen.tsx,
  // so scanning app/ alone would have missed it. A new paid flow must not
  // reintroduce the hosted-checkout redirect that #227 removed and that the
  // wallet and registration screens had both kept.
  const offenders = ['app', 'src']
    .flatMap(screensUnder)
    .filter((file) => /Linking\.openURL\(\s*[\w$.[\]]*authorizationUrl/i.test(read(file)));
  assert.deepEqual(offenders, [], `these files still leave the app for hosted checkout: ${offenders.join(', ')}`);
});

test('a completed checkout still lands on the processing screen with both ids', () => {
  // The fulfilment path is server-side (webhook + verify), and the processing
  // page keys its polling off transactionId AND reference — losing either one
  // leaves the payer staring at a spinner that can never resolve.
  const processing = read('app/registration/[id]/payment-processing.tsx');
  assert.match(processing, /verify\.mutateAsync/);
  assert.match(screen, /payment-processing/);
  assert.match(screen, /transactionId=/);
  assert.match(screen, /reference=/);
});

test('the initiate call still carries the per-visit idempotency key', () => {
  // One key per screen visit, not per tap: a double-tap or a network retry that
  // reuses it cannot open a second Paystack transaction for the same fee.
  assert.match(screen, /idempotencyKey:\s*idempotencyKeyRef\.current/);
});

test('the method copy no longer promises a hosted checkout page', () => {
  // Label text is a user-visible claim about where the payment happens.
  assert.doesNotMatch(screen, /hosted checkout/i);
});

test('mock mode, which mints no transaction at all, still reaches verification', () => {
  // registration.api's mock branch returns no authorizationUrl on purpose (the
  // URL it used to fabricate pointed at a real Paystack domain with a reference
  // Paystack never issued, so it always died on their error page). The old code
  // tolerated the missing URL; a plane that demanded one would turn that working
  // path into an error alert.
  assert.match(screen, /if \(!result\.authorizationUrl\)/);
  assert.doesNotMatch(screen, /throw new Error\('Paystack did not return a payment URL/);
});
