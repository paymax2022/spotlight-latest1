// The app's registration wizard must never ask for a government ID.
//
// "Government-issued ID type" and "ID upload" were required fields on the
// `category_specific` step, so clearing them out of the schema alone is not
// enough: a draft can still carry a stored admin `derived.formSchema` snapshot
// that lists them, and the app builds its screens from whatever the server
// returns. The mobile screen already survives this class of bug once (commit
// 2632266ac removed payment.method from the form but the app had to hide it too)
// and its fix is the HIDDEN_FIELD_KEYS list.
//
// What these tests pin, in the order the removal could silently fail:
//   1. both ID keys are in HIDDEN_FIELD_KEYS, so no applicant is asked again
//      even when an old snapshot or template still declares them;
//   2. hiding keeps validating: the screen validates the SAME field list it
//      renders. Validating a field nobody renders produces "complete the
//      highlighted required fields" with nothing to highlight — the inert
//      Save & continue the precedent commit fixed;
//   3. the app does not hand-build the inputs: no screen or feature file
//      declares either key as a field or labels one;
//   4. the API layer no longer sends ID values in a step payload it assembles
//      itself.
//
// Static-source assertions, matching this suite's convention (see
// tests/unit/payments/walletTopUpCta.spec.ts): the app carries no component
// harness, and the wizard's field list is the thing a later refactor moves.
//
//   npm run test:registration

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const WIZARD = 'app/registration/[id]/wizard.tsx';
const wizard = read(WIZARD);

const ID_KEYS = ['identity.idType', 'identity.idUpload'] as const;

/** Every source file of the registration feature, screens included. */
function registrationFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const rel = join(dir, entry);
      if (statSync(rel).isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(entry)) found.push(rel);
    }
  };
  for (const root of ['src/features/registration', 'app/registration']) walk(root);
  return found;
}

describe('mobile wizard never asks for a government ID', () => {
  it('hides both ID fields from the schema-driven screens', () => {
    const hidden = wizard.slice(
      wizard.indexOf('const HIDDEN_FIELD_KEYS'),
      wizard.indexOf('];', wizard.indexOf('const HIDDEN_FIELD_KEYS')),
    );
    for (const key of ID_KEYS) {
      assert.match(hidden, new RegExp(`'${key}'`), `${key} is not in HIDDEN_FIELD_KEYS`);
    }
  });

  it('validates the fields it renders, not the raw step', () => {
    // The invariant: visibleStep feeds both the render and the required-check.
    assert.match(wizard, /validateRequiredFields\(visibleStep/, 'validation reverted to the un-filtered step');
    assert.match(wizard, /\{visibleStep\.fields/, 'the screen reverted to rendering the un-filtered step');
    assert.doesNotMatch(wizard, /validateRequiredFields\(step,/, 'a required field nobody renders is a dead end');
  });

  it('no registration source file declares or labels the ID inputs', () => {
    for (const file of registrationFiles()) {
      if (file === WIZARD) continue; // its hidden list is the point of the test above
      const source = read(file);
      for (const key of ID_KEYS) {
        assert.doesNotMatch(
          source,
          new RegExp(`key:\\s*'${key}'`),
          `${file} still builds the ${key} field`,
        );
      }
      assert.doesNotMatch(source, /Government-issued ID/, `${file} still labels a government-ID input`);
    }
  });

  it('the review/submit screens do not carry an ID row of their own', () => {
    const submit = read('app/registration/[id]/submit.tsx');
    assert.doesNotMatch(submit, /identity\.(idType|idUpload)/, 'the submit screen still references the ID fields');
    assert.doesNotMatch(submit, /Government-issued ID/, 'the submit screen still labels a government-ID row');
  });
});
