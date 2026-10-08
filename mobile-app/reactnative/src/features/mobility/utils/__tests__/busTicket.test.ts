// node --experimental-strip-types --test "src/features/mobility/utils/__tests__/*.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSeatNumber, isValidFareKobo, requireFareKobo, derivePhase, normalizeBusTicket,
  toCancelResult, parseCancelError, busSeatMapErrKind, isBookableSeat, busPhaseTone, isTicketActive, cancelResultCopy, cancelErrorCopy, cancelPolicyCopy,
} from '../busTicket.ts';

test('parseSeatNumber converts to integer >= 1 and rejects junk', () => {
  assert.equal(parseSeatNumber('12'), 12);
  assert.equal(parseSeatNumber(' 3 '), 3);
  assert.equal(parseSeatNumber(7), 7);
  for (const bad of ['A1', '0', '-2', '1.5', '', undefined, null, '1e3', '12abc']) {
    assert.throws(() => parseSeatNumber(bad), /Invalid seat/);
  }
});

test('fare validation: positive integer kobo only', () => {
  assert.equal(isValidFareKobo(450000), true);
  for (const bad of [0, -1, 1.5, NaN, '4500', undefined, null]) assert.equal(isValidFareKobo(bad), false);
  assert.equal(requireFareKobo(100), 100);
  assert.throws(() => requireFareKobo(0));
  assert.throws(() => requireFareKobo(undefined));
});

test('derivePhase', () => {
  assert.equal(derivePhase('cancelled', 'issued', 'refunded'), 'refunded');
  assert.equal(derivePhase('refunded', 'issued', 'refunded'), 'refunded');
  for (const rs of ['pending', 'failed', 'manual_required']) assert.equal(derivePhase('cancelled', 'issued', rs), 'cancelled_pending_refund');
  assert.equal(derivePhase('cancelled', 'issued', 'none'), 'cancelled');
  assert.equal(derivePhase('issued', 'boarded', 'none'), 'boarded');
  assert.equal(derivePhase('completed', 'boarded', 'none'), 'completed');
  assert.equal(derivePhase('boarding', 'issued', 'none'), 'boarding');
  assert.equal(derivePhase('issued', 'issued', 'none'), 'issued');
  assert.equal(derivePhase(undefined, undefined, undefined), 'issued');
});

const raw = {
  id: 't1', userId: 'u', scheduleId: 's1', seatNumber: 12, passengerName: 'Ada', passengerPhone: '+234',
  qrCode: 'QR1', fareKobo: 450000, paymentStatus: 'paid', boardingStatus: 'issued', status: 'issued',
  createdAt: '2026-01-01T00:00:00Z', refundStatus: 'none', departureTime: '2026-02-01T08:00:00Z',
  cancelDeadline: '2026-02-01T06:00:00Z', cancelCutoffMinutes: 120, cancellable: true,
};

test('normalizeBusTicket maps backend payload', () => {
  const t = normalizeBusTicket(raw);
  assert.equal(t.seatNumber, '12');
  assert.equal(t.fareKobo, 450000);
  assert.equal(t.departAt, raw.departureTime);
  assert.equal(t.paymentStatus, 'settled');
  assert.equal(t.phase, 'issued');
  assert.equal(t.qrCode, 'QR1');
  assert.equal(t.cancellable, true);
  assert.equal(t.cancelDeadline, raw.cancelDeadline);
});

test('normalizeBusTicket: refunded cancel voids QR; pending refund is not refunded', () => {
  const refunded = normalizeBusTicket({ ...raw, status: 'cancelled', refundStatus: 'refunded', paymentStatus: 'refunded', cancellable: false });
  assert.equal(refunded.phase, 'refunded');
  assert.equal(refunded.qrCode, null);
  assert.equal(refunded.paymentStatus, 'refunded');
  const pending = normalizeBusTicket({ ...raw, status: 'cancelled', refundStatus: 'pending', cancelDeadline: null, cancelCutoffMinutes: null });
  assert.equal(pending.phase, 'cancelled_pending_refund');
  assert.equal(pending.paymentStatus, 'settled');
  assert.equal(pending.cancelDeadline, null);
  assert.equal(pending.cancellable, true); // passthrough of the server verdict
});

test('toCancelResult', () => {
  assert.deepEqual(toCancelResult({ ok: true, status: 'cancelled', refund_status: 'refunded', refunded_kobo: 450000, message: 'ok' }),
    { refundStatus: 'refunded', refundedKobo: 450000, message: 'ok' });
  assert.equal(toCancelResult({ refund_status: 'pending', refunded_kobo: 99 }).refundedKobo, 0);
  assert.equal(toCancelResult({}).refundStatus, 'pending'); // unknown never counts as refunded
});

test('parseCancelError reads code from several shapes', () => {
  assert.equal(parseCancelError({ response: { data: { code: 'CANCEL_WINDOW_CLOSED', message: 'cutoff 2h' } } }).code, 'CANCEL_WINDOW_CLOSED');
  assert.equal(parseCancelError({ response: { data: { error: 'REFUND_REQUIRES_SUPPORT' } } }).code, 'REFUND_REQUIRES_SUPPORT');
  assert.equal(parseCancelError({ response: { data: { error_code: 'INVALID_STATE' } } }).code, 'INVALID_STATE');
  const u = parseCancelError(new Error('Network Error'));
  assert.equal(u.code, 'UNKNOWN');
  assert.equal(u.message, 'Network Error');
});

test('cancel copy never claims money back unless refunded', () => {
  const ok = cancelResultCopy({ refundStatus: 'refunded', refundedKobo: 450000, message: '' });
  assert.match(ok.text, /₦4,500 has been returned to your wallet/);
  for (const rs of ['pending', 'failed'] as const) {
    const c = cancelResultCopy({ refundStatus: rs, refundedKobo: 0, message: '' });
    assert.match(c.text, /not been returned yet/);
    assert.doesNotMatch(c.text, /has been returned to/);
  }
  assert.match(cancelResultCopy({ refundStatus: 'manual_required', refundedKobo: 0, message: '' }).text, /contact support/);
  assert.match(cancelErrorCopy('REFUND_REQUIRES_SUPPORT', ''), /contact support/i);
  assert.equal(cancelErrorCopy('CANCEL_WINDOW_CLOSED', 'Closes 2h before'), 'Closes 2h before');
});

test('cancelPolicyCopy reflects server verdict and cutoff', () => {
  const on = cancelPolicyCopy({ cancellable: true, cancelDeadline: 'D', cancelCutoffMinutes: 120 }, (s) => `<${s}>`);
  assert.equal(on.enabled, true);
  assert.match(on.hint!, /until <D>/);
  assert.doesNotMatch(on.label + on.hint, /money back|refunded/i);
  const off = cancelPolicyCopy({ cancellable: false, cancelDeadline: 'D', cancelCutoffMinutes: 120 }, (s) => `<${s}>`);
  assert.equal(off.enabled, false);
  assert.match(off.hint!, /<D>/);
  assert.match(cancelPolicyCopy({ cancellable: false, cancelDeadline: null, cancelCutoffMinutes: 90 }).hint!, /90 min/);
});

test('seat-map error kind and bookable seat', () => {
  assert.equal(busSeatMapErrKind(new Error('Fare unavailable for this trip. Please try again.')), 'genericError');
  assert.equal(busSeatMapErrKind(new Error('Network Error')), 'offline');
  assert.equal(busSeatMapErrKind({ response: { status: 500 } }), 'genericError');
  assert.equal(isBookableSeat('5'), true);
  assert.equal(isBookableSeat('A1'), false);
});

test('phase tone and activity', () => {
  assert.equal(busPhaseTone('cancelled_pending_refund'), 'warning');
  assert.equal(busPhaseTone('refunded'), 'danger');
  assert.equal(busPhaseTone('completed'), 'success');
  assert.equal(isTicketActive('cancelled_pending_refund'), false);
  assert.equal(isTicketActive('issued'), true);
});
