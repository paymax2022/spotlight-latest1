// node --experimental-strip-types --test "src/features/mobility/utils/__tests__/*.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyValidateError, normalizeQrPayload, toScheduleCancelResult, scheduleCancelCopy, boardingVerdict,
} from '../busBoarding.ts';

const httpErr = (status: number, error?: string) => ({ response: { status, data: error ? { error, code: 'INVALID_STATE' } : {} } });

test('validate 409s split on the Go message', () => {
  assert.equal(classifyValidateError(httpErr(409, 'ticket already boarded')).outcome, 'already_boarded');
  assert.equal(classifyValidateError(httpErr(409, 'boarding has not opened for this trip yet')).outcome, 'not_open');
  assert.equal(classifyValidateError(httpErr(409, 'boarding is closed for this trip')).outcome, 'closed');
  assert.equal(classifyValidateError(httpErr(409, 'this trip was cancelled')).outcome, 'trip_cancelled');
  const inv = classifyValidateError(httpErr(409, 'ticket not valid'));
  assert.equal(inv.outcome, 'invalid');
  assert.equal(inv.ok, false);
});

test('validate 403/404/offline/5xx never report boarded', () => {
  assert.equal(classifyValidateError(httpErr(403, 'not the route operator')).outcome, 'not_operator');
  assert.equal(classifyValidateError(httpErr(404, 'ticket not found')).outcome, 'not_found');
  assert.equal(classifyValidateError(new Error('Network Error')).outcome, 'offline');
  const u = classifyValidateError(httpErr(500, 'boom'));
  assert.equal(u.outcome, 'unknown');
  for (const v of [u, classifyValidateError(httpErr(403))]) assert.equal(v.ok, false);
  assert.equal(boardingVerdict('boarded').ok, true);
});

test('normalizeQrPayload trims and rejects junk', () => {
  assert.equal(normalizeQrPayload('  6f1c2a7e-0000-4000-8000-000000000001 \n'), '6f1c2a7e-0000-4000-8000-000000000001');
  for (const bad of ['', '   ', 'two words', 'x'.repeat(201)]) assert.equal(normalizeQrPayload(bad), null);
});

test('schedule cancel result maps snake_case and copy is honest', () => {
  const r = toScheduleCancelResult({ schedule_id: 's1', status: 'cancelled', tickets_total: 3, refunded: 1, pending: 1, failed: 0, manual_required: 1, complete: false }, 'x');
  assert.deepEqual(r, { scheduleId: 's1', status: 'cancelled', ticketsTotal: 3, refunded: 1, pending: 1, failed: 0, manualRequired: 1, complete: false });
  const c = scheduleCancelCopy(r);
  assert.equal(c.tone, 'warning');
  assert.match(c.text, /1 of 3 passengers refunded/);
  assert.match(c.text, /1 refund still processing/);
  assert.match(c.text, /1 needs a manual refund/);

  const done = scheduleCancelCopy(toScheduleCancelResult({ tickets_total: 2, refunded: 2, complete: true }, 's2'));
  assert.equal(done.tone, 'success');
  assert.equal(scheduleCancelCopy(toScheduleCancelResult({ tickets_total: 0, complete: true }, 's3')).tone, 'success');
  assert.equal(toScheduleCancelResult(null, 's4').scheduleId, 's4');
});
