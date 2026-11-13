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
