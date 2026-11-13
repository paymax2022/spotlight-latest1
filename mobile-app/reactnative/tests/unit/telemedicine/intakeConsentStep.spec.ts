// Leaving the consent screen happens on the server's word, not on the request's.
//
// The bug these guard: consent.tsx called
// saveDraft.mutate({ answers: {}, consentVersion }, { onSuccess: … }) with no error
// handling at all, so when PUT /health/intake/appointments/:id/draft refused, the
// button simply stopped spinning. The patient stayed on "Before we start" with no
// message, no way forward, and no way of knowing that the agreement — which is what
// grants the assigned doctor access to their answers — had NOT been recorded. The
// refusal is the same one the wizard documents in intakeDraftLock.spec.ts (the
// intake frozen at status=SUBMITTED) plus every ordinary transport failure.
//
// The success path had the mirror flaw: it navigated because the request came back,
// not because the consent version landed, so a write the server accepted but did not
// persist bounced the patient straight back here from a wizard that had already
// decided the agreement was missing.
//
// Both are answered the same way: re-read the bundle and go on only if it proves the
// agreement is on the server, or the intake is already submitted (in which case
// nothing more can be recorded here and the wizard shows the frozen intake read-only).

import test from 'node:test';
import assert from 'node:assert/strict';

import { decideConsentStep } from '@/features/health/intakeDraftLock';

/** Take the stay branch's copy, failing the test if the decision was to move on. */
const stayMessage = (input: Parameters<typeof decideConsentStep>[0]): string => {
  const decision = decideConsentStep(input);
  if (decision.kind === 'toIntake') {
    assert.fail(`expected the patient to stay on consent, got: ${JSON.stringify(decision)}`);
  }
  return decision.message;
};

test('an agreement the server has recorded lets the patient into the wizard', () => {
  assert.deepEqual(
    decideConsentStep({ consentAccepted: true, intakeSubmitted: false }),
    { kind: 'toIntake' },
  );
});

test('an already submitted intake is not held on the consent screen', () => {
  // The draft route refuses writes once the intake is submitted, so staying here
  // offers a checkbox that can never be recorded. The wizard renders that state
  // read-only, which is the only honest place to send the patient.
  assert.deepEqual(
    decideConsentStep({ consentAccepted: false, intakeSubmitted: true }),
    { kind: 'toIntake' },
  );
});

test('nothing recorded keeps the patient on consent, with a message instead of silence', () => {
  assert.equal(stayMessage({ consentAccepted: false, intakeSubmitted: false }).trim().length > 0, true);
});

test('a bundle that could not be read is not read as an agreement', () => {
  // Refetch failures leave both flags undefined; assuming success here would walk
  // the patient into a wizard that bounces them back with no explanation.
  assert.equal(decideConsentStep({}).kind, 'stay');
});

test('the consent copy names the agreement, without the server’s vocabulary', () => {
  const message = stayMessage({ consentAccepted: false, intakeSubmitted: false });
  assert.match(message, /agreement/i);
  assert.doesNotMatch(message, /preconsult|consent_version|draft|PUT|500/i);
});
