// What a refused intake draft save means to the patient.
//
// The wizard saves the draft on every keystroke (debounced) and again on
// "Save & continue", and until now it ignored both results — see
// tests/unit/telemedicine/intakeDraftLock.spec.ts for the 400 that advanced the
// steps anyway. Refusals need separating because the reactions are opposite: the
// server freezing the intake (status=SUBMITTED) makes every later save pointless,
// while a dropped connection or a validation rejection leaves the local draft
// intact and the patient still able to work.
//
// The freeze is read off the server's copy rather than a status code because that
// route has no machine-readable error code: preconsultFail sends
// {"error":"preconsult: intake already submitted"} at 400, and 4xx messages pass
// through httperr.Sanitize verbatim, so src/api/client.ts surfaces it on
// error.message. Nothing here echoes that string — patients get the sentences
// below, and a 400 we cannot recognise stays the recoverable kind.

export type DraftSaveOutcome =
  /** The intake is frozen server-side: editing further cannot reach the doctor. */
  | { kind: 'locked'; message: string }
  /** The save failed, but the answers are still the patient's to finish. */
  | { kind: 'unsaved'; message: string };

const LOCKED_MESSAGE =
  'This intake was already submitted, so it can no longer be changed here. Answers typed after that did not reach your doctor.';

const UNSAVED_MESSAGE =
  'We couldn’t save your latest answers to the server, but they are kept on this device.';

export function describeDraftSaveError(error: unknown): DraftSaveOutcome | null {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  if (/already submitted/i.test(message)) return { kind: 'locked', message: LOCKED_MESSAGE };
  return { kind: 'unsaved', message: UNSAVED_MESSAGE };
}

// The consent step (M2) saves through the same draft route, so it meets the same
// refusals — but its question is narrower than "should editing stop": the patient
// pressed "Agree & continue" and wants to know whether the agreement that lets the
// assigned doctor read their answers was actually recorded. Answering that from the
// response alone goes wrong both ways (a refusal looked like a dead end, an accepted
// but unpersisted write looked like progress and bounced), so the decision reads the
// server's state instead of its prose. See tests/unit/telemedicine/intakeConsentStep.spec.ts.

export type ConsentStepDecision =
  /** The agreement is on the server, or there is nothing left to agree to. */
  | { kind: 'toIntake' }
  /** Still on consent, and the patient is told why. */
  | { kind: 'stay'; message: string };

const CONSENT_NOT_RECORDED_MESSAGE =
  'We couldn’t record your agreement, so your health details have not been shared with the doctor yet. Check your connection and try again.';

export function decideConsentStep(input: {
  consentAccepted?: boolean;
  intakeSubmitted?: boolean;
}): ConsentStepDecision {
  // A submitted intake outranks the missing agreement: the draft route refuses
  // writes now, so the wizard's read-only view is the only screen that can tell
  // this patient anything true.
  if (input.consentAccepted || input.intakeSubmitted) return { kind: 'toIntake' };
  return { kind: 'stay', message: CONSENT_NOT_RECORDED_MESSAGE };
}
