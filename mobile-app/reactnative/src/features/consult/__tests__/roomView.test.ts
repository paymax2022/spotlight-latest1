import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canJoinNow,
  extensionAction,
  maxExtensionMinutes,
  openExtension,
  viewerOf,
} from '../roomView.ts';
import type { ConsultExtension, ConsultSession } from '../types.ts';

const START = Date.parse('2026-11-04T10:00:00.000Z');
const MIN = 60_000;

function session(over: Partial<ConsultSession> = {}): ConsultSession {
  return {
    id: 'sess-1',
    vertical: 'telemedicine',
    mode: 'video',
    patient_id: 'patient-1',
    provider_user_id: 'doctor-1',
    source_ref: 'appointment-1',
    duration_minutes: 30,
    price_kobo: 200_000,
    booked_start: new Date(START).toISOString(),
    ends_at: new Date(START + 30 * MIN).toISOString(),
    warn_at: new Date(START + 25 * MIN).toISOString(),
    state: 'scheduled',
    room_name: 'consult-sess-1',
    server_now: new Date(START).toISOString(),
    extendable: true,
    provider_owner_kind: 'doctor',
    provider_owner_id: 'doctor-1',
    ...over,
  };
}

function extension(over: Partial<ConsultExtension> = {}): ConsultExtension {
  return {
    id: 'ext-1',
    session_id: 'sess-1',
    requested_by: 'patient-1',
    added_minutes: 15,
    price_kobo: 100_000,
    status: 'pending_approval',
    created_at: new Date(START).toISOString(),
    ...over,
  };
}

test('viewerOf distinguishes the patient, the provider and everyone else', () => {
  const s = session();
  assert.equal(viewerOf(s, 'patient-1'), 'patient');
  assert.equal(viewerOf(s, 'doctor-1'), 'provider');
  assert.equal(viewerOf(s, 'stranger'), 'observer');
  assert.equal(viewerOf(s, undefined), 'observer');
});

test('canJoinNow opens ten minutes before the booked start, never after the end', () => {
  const s = session();
  assert.equal(canJoinNow(s, START - 11 * MIN), false);
  assert.equal(canJoinNow(s, START - 10 * MIN), true);
  assert.equal(canJoinNow(s, START + MIN), true);
  assert.equal(canJoinNow({ ...s, state: 'live' }, START - 20 * MIN), true);
  assert.equal(canJoinNow(s, START + 30 * MIN), false);
  assert.equal(canJoinNow({ ...s, state: 'ended' }, START + MIN), false);
  assert.equal(canJoinNow({ ...s, state: 'cancelled' }, START + MIN), false);
});

test('openExtension returns only requests still awaiting the other side', () => {
  const closed = [
    extension({ id: 'a', status: 'paid' }),
    extension({ id: 'b', status: 'declined' }),
    extension({ id: 'c', status: 'expired' }),
  ];
  assert.equal(openExtension(closed), undefined);
  const pending = extension({ id: 'd', status: 'pending_approval' });
  assert.equal(openExtension([...closed, pending])?.id, 'd');
});

test('a pending request asks the provider to review and the patient to wait', () => {
  const ext = extension();
  assert.deepEqual(extensionAction(ext, 'provider', START), {
    kind: 'approve',
    label: 'Review request',
    extensionId: 'ext-1',
  });
  assert.equal(extensionAction(ext, 'patient', START).kind, 'wait');
});

test('an approved request asks the patient to pay its price and the provider to wait', () => {
  const ext = extension({
    status: 'approved_awaiting_payment',
    approved_at: new Date(START).toISOString(),
    payment_expires_at: new Date(START + 5 * MIN).toISOString(),
  });
  assert.deepEqual(extensionAction(ext, 'patient', START + MIN), {
    kind: 'pay',
    label: 'Pay to extend',
    extensionId: 'ext-1',
    amountKobo: 100_000,
  });
  assert.equal(extensionAction(ext, 'provider', START + MIN).kind, 'wait');
});

test('an approval past its payment window is closed, not payable', () => {
  const ext = extension({
    status: 'approved_awaiting_payment',
    payment_expires_at: new Date(START + 5 * MIN).toISOString(),
  });
  const action = extensionAction(ext, 'patient', START + 5 * MIN);
  assert.equal(action.kind, 'closed');
  assert.equal(action.amountKobo, undefined);
});

test('paid and declined requests resolve without asking either side to act', () => {
  const paid = extension({ status: 'paid', price_kobo: 0 });
  assert.deepEqual(extensionAction(paid, 'patient', START), {
    kind: 'none',
    label: 'Extended by 15 min',
    extensionId: 'ext-1',
  });
  assert.equal(extensionAction(extension({ status: 'declined' }), 'patient', START).kind, 'request');
  assert.equal(extensionAction(undefined, 'patient', START).kind, 'request');
  assert.equal(extensionAction(extension(), 'observer', START).kind, 'none');
});

test('maxExtensionMinutes honours the four-hour ceiling and the 240-minute cap', () => {
  assert.equal(maxExtensionMinutes(session()), 210);
  // A session already running long leaves only the headroom to booked_start + 4h.
  assert.equal(
    maxExtensionMinutes(session({ ends_at: new Date(START + 210 * MIN).toISOString() })),
    30,
  );
  assert.equal(
    maxExtensionMinutes(session({ ends_at: new Date(START + 300 * MIN).toISOString() })),
    0,
  );
  assert.equal(maxExtensionMinutes(session({ ends_at: 'not-a-date' })), 0);
});
