/**
 * CS-003 — explicit RUNTIME no-bleed assertion.
 *
 * `contest-distinctness.spec.ts` proves each built-in contest's *template*
 * produces a different requirement set. That is a static property of the code
 * in `./forms/<slug>.ts`. It does not prove that two admin-configured contest
 * forms (`derived.formSchema`, built via `buildStepsFromSchema` per
 * `forms/index.ts`) are runtime-isolated — i.e. that building contest B's form
 * cannot mutate or leak into contest A's already-built steps, and that two
 * drafts in flight at the same time each see only their own contest's schema.
 *
 * This is the gap CS-002/CS-003's "no live preview pane" / "add explicit
 * no-bleed assertion" notes call out — exercised here at the
 * buildRegistrationSteps entry point the wizard and store both call.
 */
import { describe, it, expect } from 'vitest';
import { buildRegistrationSteps } from '@/src/features/registration/config';
import type { RegistrationDraft, ContestFormSchema } from '@/src/features/registration/types';

function draftWithSchema(contestSlug: string, schema: ContestFormSchema): RegistrationDraft {
  return {
    id: `draft-${contestSlug}`,
    reference: 'R',
    contestSlug,
    status: 'draft',
    role: 'public_user',
    createdAt: '',
    updatedAt: '',
    formData: {
      'derived.age': 30,
      'derived.legalAdultAge': 18,
      'derived.formSchema': schema,
    },
    completionPercent: 0,
    fraudFlags: [],
  };
}

const schemaA: ContestFormSchema = {
  version: 1,
  includedFields: ['personal.firstName', 'talent.primarySkill'],
  requiredOverrides: { 'talent.primarySkill': true },
  customFields: [
    { key: 'custom.contest_a_only', label: 'Contest A only question', type: 'text', step: 'category_specific', required: true },
  ],
};

const schemaB: ContestFormSchema = {
  version: 1,
  includedFields: ['personal.lastName', 'category.businessName'],
  requiredOverrides: {},
  customFields: [
    { key: 'custom.contest_b_only', label: 'Contest B only question', type: 'textarea', step: 'category_specific', required: false },
  ],
};

describe('CS-003: two admin-configured contest forms are runtime-isolated (no bleed)', () => {
  it('each contest sees exactly its own included/custom fields, never the other\'s', () => {
    const stepsA = buildRegistrationSteps(draftWithSchema('contest-a', schemaA));
    const stepsB = buildRegistrationSteps(draftWithSchema('contest-b', schemaB));

    const keysA = stepsA.flatMap((s) => s.fields.map((f) => f.key));
    const keysB = stepsB.flatMap((s) => s.fields.map((f) => f.key));

    expect(keysA).toContain('custom.contest_a_only');
    expect(keysA).toContain('talent.primarySkill');
    expect(keysA).not.toContain('custom.contest_b_only');
    expect(keysA).not.toContain('category.businessName');

    expect(keysB).toContain('custom.contest_b_only');
    expect(keysB).toContain('category.businessName');
    expect(keysB).not.toContain('custom.contest_a_only');
    expect(keysB).not.toContain('talent.primarySkill');
  });

  it('building B does not retroactively change an already-built A result (no shared mutable cache)', () => {
    const draftA = draftWithSchema('contest-a', schemaA);
    const stepsA1 = buildRegistrationSteps(draftA);
    const snapshotA1 = JSON.stringify(stepsA1);

    // Build B (and even a third contest) in between.
    buildRegistrationSteps(draftWithSchema('contest-b', schemaB));
    buildRegistrationSteps(draftWithSchema('contest-c', schemaB));

    const stepsA2 = buildRegistrationSteps(draftA);
    expect(JSON.stringify(stepsA2)).toBe(snapshotA1);
  });

  it('mutating the schema object passed for contest A does not affect contest B\'s already-built steps', () => {
    const schemaAClone: ContestFormSchema = JSON.parse(JSON.stringify(schemaA));
    const draftA = draftWithSchema('contest-a', schemaAClone);
    const draftB = draftWithSchema('contest-b', schemaB);

    const stepsB = buildRegistrationSteps(draftB);
    const keysBBefore = stepsB.flatMap((s) => s.fields.map((f) => f.key));

    // Mutate A's schema in place after B has already been built.
    schemaAClone.customFields!.push({ key: 'custom.late_addition', label: 'Late', type: 'text', step: 'category_specific', required: false });
    buildRegistrationSteps(draftA);

    const stepsBAfter = buildRegistrationSteps(draftB);
    const keysBAfter = stepsBAfter.flatMap((s) => s.fields.map((f) => f.key));

    expect(keysBAfter).toEqual(keysBBefore);
    expect(keysBAfter).not.toContain('custom.late_addition');
  });

  it('required-override isolation: a field required in one contest is not silently required in another', () => {
    const stepsA = buildRegistrationSteps(draftWithSchema('contest-a', schemaA));
    const stepsB = buildRegistrationSteps(draftWithSchema('contest-b', {
      ...schemaB,
      includedFields: [...schemaB.includedFields, 'talent.primarySkill'],
    }));

    const fieldInA = stepsA.flatMap((s) => s.fields).find((f) => f.key === 'talent.primarySkill');
    const fieldInB = stepsB.flatMap((s) => s.fields).find((f) => f.key === 'talent.primarySkill');

    expect(fieldInA?.required).toBe(true); // schemaA overrides it required
    expect(fieldInB?.required).toBe(false); // schemaB never touched it — catalog default applies
  });
});
