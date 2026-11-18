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

/**
 * True when this source hands a Paystack authorization URL to the external
 * browser — the defect, in any screen or shared component.
 *
 * Call sites are matched by shape and comments are left alone (see the test
 * below for what "helpfully" stripping them did). `Linking.openURL(someFn())`
 * stays invisible to this, which is why the app-wide test is a tripwire and not
 * a proof.
 */
const CALL_RE = /\bLinking\.openURL\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
const ASSIGN_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*[^;\n]*authorizationUrl/gi;

function handsOffToBrowser(src: string): boolean {
  // Which names were handed an authorization URL, in a first pass over the
  // fixed assignment pattern — identifiers are then compared as strings, so
  // nothing read from the file ever becomes a pattern.
  const assigned = new Set<string>();
  for (const m of src.matchAll(ASSIGN_RE)) assigned.add(m[1]);

  for (const call of src.matchAll(CALL_RE)) {
    const arg = call[1];
    if (/authorizationUrl/i.test(arg)) return true;              // Linking.openURL(r.authorizationUrl)
    if (assigned.has(arg)) return true;                           // const url = r.authorizationUrl; openURL(url)
  }
  return false;
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
    .filter((file) => handsOffToBrowser(read(file)));
  assert.deepEqual(offenders, [], `these files still leave the app for hosted checkout: ${offenders.join(', ')}`);
});

test('the detector does not flag the in-app plane itself', () => {
  // These three name authorizationUrl and Linking.openURL in the same file — in
  // comments explaining why they DO NOT hand it over. A detector that matched
  // comments would flag the fix, and the first person to hit that deletes the
  // guard instead of the defect.
  assert.equal(handsOffToBrowser(read('src/features/payments/useGatewayCheckout.ts')), false);
  assert.equal(handsOffToBrowser(read('src/features/payments/usePurchasePayment.ts')), false);
  assert.equal(handsOffToBrowser(read('src/features/registration/api/registration.api.ts')), false);
});

test('the detector catches the hand-off written directly', () => {
  assert.equal(handsOffToBrowser('await Linking.openURL(result.authorizationUrl);'), true);
});

test('the detector catches the hand-off behind a local variable', () => {
  // The bypass this guard used to have: assigning the URL first hides the call
  // from a pattern that only reads what is inside the parentheses.
  assert.equal(handsOffToBrowser('const url = result.authorizationUrl;\nawait Linking.openURL(url);'), true);
});

test('comments elsewhere in the file do not blind the detector', () => {
  // Measured, not assumed. An earlier version of this detector stripped `/* … */`
  // with a regex before looking for the call. This screen has a line comment
  // that ends in a route glob (`…/payment/*.`), and that `/*` opened a fake
  // block comment which ran on to the next `*/` — a JSX comment eight lines
  // later — so the stripper ate the real hand-off in between and the app-wide
  // test went green with the defect still in the file.
  const realistic = [
    '// routes: /api/registration/applications/[id]/payment/*.',
    'const feeKobo = feeNgn * 100;',
    'if (result.authorizationUrl) {',
    '  await Linking.openURL(result.authorizationUrl);',
    '}',
    '{/* Fee summary */}',
  ].join('\n');
  assert.equal(handsOffToBrowser(realistic), true);
});

test('the detector builds no pattern out of file text', () => {
  // CodeQL flagged the first version of this detector (js/incomplete-sanitization,
  // alert #231): it interpolated an identifier read from the scanned file into
  // `new RegExp` and escaped only dots, not backslashes. The identifier charset
  // made that unreachable in practice, but "regex built from what we read" is the
  // pattern that gets quietly wrong, so the detector matches with fixed patterns
  // and compares strings instead. This test is what keeps it that way.
  assert.doesNotMatch(read('tests/unit/payments/registrationCheckout.spec.ts'), /new RegExp\(/);
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
