// The state/LGA cascade the song hand-in form uses. The server only requires
// these to be non-empty, so the point of the select is a consistent answer —
// which means the list must come from the app's own dataset, not a second table
// that can drift.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPEN_MIC_COUNTRY,
  STATE_OPTIONS,
  knownStateName,
  lgasForState,
} from '@/features/openmic/location';

describe('Open Mic country', () => {
  it('is the one country the web entry form offers', () => {
    assert.equal(OPEN_MIC_COUNTRY, 'Nigeria');
  });
});

describe('STATE_OPTIONS', () => {
  it('is a flat list of non-empty, unique names', () => {
    assert.ok(STATE_OPTIONS.length >= 36, `expected the 36 states plus the FCT, got ${STATE_OPTIONS.length}`);
    assert.equal(new Set(STATE_OPTIONS).size, STATE_OPTIONS.length);
    assert.ok(STATE_OPTIONS.every((name) => name.trim().length > 0));
  });

  it('includes the capital and the states an applicant is most likely to pick', () => {
    for (const name of ['Lagos', 'Rivers', 'Kano', 'Oyo']) {
      assert.ok(STATE_OPTIONS.includes(name), `${name} missing from the hand-in select`);
    }
    // Spelled "FCT - Abuja" in the dataset. Asserted by pattern rather than by
    // the exact string so the select keeps offering the capital either way.
    const fct = STATE_OPTIONS.filter((name) => /FCT|Abuja/i.test(name));
    assert.equal(fct.length, 1, `expected exactly one Federal Capital entry, got ${fct.join(' / ')}`);
    assert.ok(lgasForState(fct[0]).length > 0);
  });
});

describe('knownStateName', () => {
  it('accepts the dataset spelling and trims surrounding space', () => {
    assert.equal(knownStateName('Lagos'), 'Lagos');
    assert.equal(knownStateName('  Lagos  '), 'Lagos');
  });

  it('rejects an unknown or empty answer', () => {
    // The server stores free text, so this is about the select staying honest,
    // not about refusing the artist.
    assert.equal(knownStateName('lagos'), '');
    assert.equal(knownStateName('Springfield'), '');
    assert.equal(knownStateName(''), '');
    assert.equal(knownStateName(null), '');
    assert.equal(knownStateName(undefined), '');
  });
});

describe('lgasForState', () => {
  it('cascades off the state, like the web form', () => {
    const lagos = lgasForState('Lagos');
    assert.ok(lagos.length > 10);
    assert.ok(lagos.includes('Alimosho'));
    assert.ok(lagos.includes('Agege'));
  });

  it('returns nothing for an unknown state so the select can ask for one first', () => {
    assert.deepEqual(lgasForState('Springfield'), []);
    assert.deepEqual(lgasForState(''), []);
    assert.deepEqual(lgasForState(null), []);
    assert.deepEqual(lgasForState(undefined), []);
  });

  it('gives every listed state a non-empty LGA list', () => {
    for (const name of STATE_OPTIONS) {
      assert.ok(lgasForState(name).length > 0, `${name} has no LGAs`);
    }
  });

  it('repeats some LGA names across states, which is why the form never stores one alone', () => {
    // Nigeria really does re-use these names — Nasarawa LGA sits in Kano state
    // as well as in Nasarawa state, Surulere in Lagos and Oyo, Obi in Benue and
    // Nasarawa. An LGA string is therefore meaningless without its state, which
    // is the reason the hand-in form clears the LGA the moment the state changes
    // and disables the LGA select until a state is picked.
    const seen = new Map<string, string[]>();
    for (const name of STATE_OPTIONS) {
      for (const lga of lgasForState(name)) {
        seen.set(lga, [...(seen.get(lga) ?? []), name]);
      }
    }
    const shared = [...seen.entries()].filter(([, states]) => states.length > 1);
    assert.ok(shared.length > 0, 'expected at least one LGA name shared between states');
    assert.ok(
      shared.some(([lga, states]) => lga === 'Surulere' && states.includes('Lagos') && states.includes('Oyo')),
      'Surulere should appear in both Lagos and Oyo',
    );
    assert.ok(
      shared.some(([lga, states]) => lga === 'Nasarawa' && states.includes('Kano')),
      'Nasarawa LGA should appear inside Kano state',
    );
  });

  it('never lets one state list the same LGA twice', () => {
    for (const name of STATE_OPTIONS) {
      const lgas = lgasForState(name);
      assert.equal(new Set(lgas).size, lgas.length, `${name} repeats an LGA within itself`);
    }
  });
});
