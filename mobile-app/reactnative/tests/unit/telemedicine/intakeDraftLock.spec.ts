// A refused intake draft save is not allowed to be invisible.
//
// The bug this guards: the pre-consult wizard fires PUT
// /health/intake/appointments/:id/draft from two places — the debounced autosave
// behind every keystroke and the immediate save inside "Save & continue" — and
// neither one looks at the result (no onError, and the step index advances
// synchronously). The server refuses that route once the intake is SUBMITTED
// (backend/internal/health/preconsult/service.go:224 → preconsultFail's default
// 400 → body {"error":"preconsult: intake already submitted"}, which
// httperr.Sanitize passes through verbatim for a 4xx and src/api/client.ts:92
// copies onto error.message), so a patient whose tab was open across a submit —
// the other device, the doctor's copy, an accidental double-tap — keeps filling
// all nine steps and then hits "Could not submit", having lost every answer that
// only ever reached the device. Observed live on 2026-11-13 against :8083: the
// 400 came back and the wizard advanced anyway.
//
// The screen needs to tell the two refusals apart, because the right reaction is
// opposite: a frozen intake means stop editing (further saves can never land),
// a transport or validation failure means keep going (the local draft still has
// the work) but say so.

import test from 'node:test';
import assert from 'node:assert/strict';

import { describeDraftSaveError } from '@/features/health/intakeDraftLock';

/** The shape src/api/client.ts hands react-query: an Error carrying the server
 *  copy in `message` plus the axios `response`, and no response at all when the
 *  request never left the device. */
const serverError = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status, data: { error: message } } });

test('the server saying the intake is submitted locks further editing', () => {
  const outcome = describeDraftSaveError(
    serverError(400, 'preconsult: intake already submitted'),
  );
  assert.equal(outcome?.kind, 'locked');
});

test('the lock copy tells the patient their answers did not get through', () => {
  const outcome = describeDraftSaveError(
    serverError(400, 'preconsult: intake already submitted'),
  );
  assert.match(outcome?.message ?? '', /submitted/i);
  assert.doesNotMatch(outcome?.message ?? '', /preconsult/);
});

test('a refusal that is not the freeze keeps the patient editing, and says the save failed', () => {
  // intake.validate rejects an unknown field name outright, so a client-only key
  // 400s every save — the answers are still on the device, so the wizard must not
  // pretend the intake is locked; it must not go silent either.
  const outcome = describeDraftSaveError(
    serverError(400, 'intake: unknown field "photo_url"'),
  );
  assert.equal(outcome?.kind, 'unsaved');
  assert.ok(outcome && outcome.message.trim().length > 0);
});

test('a save that never reached the server is not read as a freeze', () => {
  // No `response` is axios's dropped-connection signature. Treating it as a
  // freeze would lock a patient out of their own intake over a bad signal.
  const outcome = describeDraftSaveError(new Error('Network Error'));
  assert.equal(outcome?.kind, 'unsaved');
});

test('a 4xx whose server copy never reached error.message is not a freeze', () => {
  // Sanitize replaces some messages, so the status alone must not be enough to
  // stop the patient: an unread 400 stays recoverable, just unacknowledged.
  const outcome = describeDraftSaveError(
    Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: {} },
    }),
  );
  assert.equal(outcome?.kind, 'unsaved');
});

test('a 404 on the draft route is not a freeze', () => {
  const outcome = describeDraftSaveError(serverError(404, 'intake not found'));
  assert.equal(outcome?.kind, 'unsaved');
});

test('no error means nothing to show', () => {
  assert.equal(describeDraftSaveError(undefined), null);
  assert.equal(describeDraftSaveError(null), null);
});
