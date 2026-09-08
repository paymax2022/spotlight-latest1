// Pure-logic unit tests for the pharmacist's action set.
// Run: node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/pharmacymerchant/*.spec.ts"
//
// These pin the client's buttons to the server's guarded state machine
// (backend/internal/health/pharmacy/model.go allowedOrderTransitions). Offering
// an action the API rejects gives the pharmacist a button that fails; hiding one
// it would accept strands a paid order with medicine undelivered.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionsFor,
  needsPharmacistAttention,
  inboxRank,
  stateLabel,
  type PharmacyOrderState,
} from '@/features/pharmacymerchant/actions';

const names = (state: string) => actionsFor(state).map((a) => a.action);

describe('actionsFor — mirrors the server transition table', () => {
  it('offers accept while the order is new or awaiting an Rx check', () => {
    assert.deepEqual(names('CREATED'), ['confirm']);
    assert.deepEqual(names('RX_PENDING_VERIFICATION'), ['confirm']);
  });

  it('offers dispense once confirmed', () => {
    assert.deepEqual(names('CONFIRMED'), ['dispense']);
  });

  it('offers dispatch once dispensed, with a fulfilment choice', () => {
    // DISPENSED -> IN_DELIVERY or READY_FOR_PICKUP; the pharmacist picks which.
    assert.deepEqual(names('DISPENSED'), ['dispatch']);
    assert.equal(actionsFor('DISPENSED')[0].requiresFulfilmentChoice, true);
  });

  it('offers completion from both fulfilment routes', () => {
    assert.deepEqual(names('IN_DELIVERY'), ['complete']);
    assert.deepEqual(names('READY_FOR_PICKUP'), ['complete']);
  });

  it('NEVER offers cancel — that is the patient’s and refunds their money', () => {
    // Service.Cancel rejects any caller who is not the patient. A cancel button
    // here would be a guaranteed 403 sitting next to a paid order.
    const every: PharmacyOrderState[] = [
      'CREATED', 'RX_PENDING_VERIFICATION', 'CONFIRMED', 'DISPENSED', 'IN_DELIVERY',
      'READY_FOR_PICKUP', 'DELIVERED', 'COLLECTED', 'CLOSED', 'CANCELLED', 'REFUNDED',
    ];
    for (const s of every) {
      assert.ok(!names(s).includes('cancel' as never), `cancel offered in ${s}`);
    }
  });

  it('requires the pickup code only for collection', () => {
    // The pharmacy is not given pickup_code; the patient presents it at the
    // counter and the server checks it. Delivery has no such credential.
    assert.equal(actionsFor('READY_FOR_PICKUP')[0].requiresPickupCode, true);
    assert.notEqual(actionsFor('IN_DELIVERY')[0].requiresPickupCode, true);
  });

  it('offers nothing once the order is finished or cancelled', () => {
    for (const s of ['DELIVERED', 'COLLECTED', 'CLOSED', 'CANCELLED', 'REFUNDED']) {
      assert.deepEqual(names(s), [], `${s} should offer no pharmacist action`);
    }
  });

  it('offers nothing for a state it does not recognise', () => {
    // A new server state must not produce a wrong button.
    assert.deepEqual(names('SOME_FUTURE_STATE'), []);
  });

  it('gives every action a label and a hint', () => {
    for (const s of ['CREATED', 'CONFIRMED', 'DISPENSED', 'IN_DELIVERY', 'READY_FOR_PICKUP']) {
      for (const a of actionsFor(s)) {
        assert.ok(a.label.length > 0, `${s}/${a.action} needs a label`);
        assert.ok(a.hint.length > 0, `${s}/${a.action} needs a hint — these move money and medicine`);
      }
    }
  });
});

describe('needsPharmacistAttention', () => {
  it('is true exactly when the order is waiting on the pharmacy', () => {
    for (const s of ['CREATED', 'RX_PENDING_VERIFICATION', 'CONFIRMED', 'DISPENSED', 'IN_DELIVERY', 'READY_FOR_PICKUP']) {
      assert.equal(needsPharmacistAttention(s), true, `${s} needs attention`);
    }
    for (const s of ['DELIVERED', 'COLLECTED', 'CLOSED', 'CANCELLED', 'REFUNDED']) {
      assert.equal(needsPharmacistAttention(s), false, `${s} does not`);
    }
  });
});

describe('inboxRank', () => {
  it('floats what needs doing above what is finished', () => {
    // Sorting purely by date buries the order someone is waiting on.
    assert.ok(inboxRank('CONFIRMED') < inboxRank('DELIVERED'));
    assert.ok(inboxRank('DELIVERED') < inboxRank('CANCELLED'));
    assert.equal(inboxRank('CREATED'), inboxRank('READY_FOR_PICKUP'));
  });
});

describe('stateLabel', () => {
  it('reads as a pharmacist would say it', () => {
    assert.equal(stateLabel('CONFIRMED'), 'To dispense');
    assert.equal(stateLabel('READY_FOR_PICKUP'), 'Awaiting collection');
  });

  it('falls back to the raw state rather than blanking', () => {
    assert.equal(stateLabel('SOME_FUTURE_STATE'), 'SOME_FUTURE_STATE');
  });
});
