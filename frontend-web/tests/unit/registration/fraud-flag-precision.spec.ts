/**
 * A `missing_id_number` fraud flag must mean "this applicant's own form asked for
 * an ID and it is blank", never "this code happens to read a fixed key".
 *
 * `runBasicFraudChecks` flagged three fixed keys on every draft:
 * `identity.idNumber`, `personal.primaryPhone`, `personal.email`. Only two of the
 * five hand-built contest forms declare an ID number at all (`reality-tv-show`,
 * `film-academy`), both OPTIONAL, and the capability-driven default form declares
 * none. So every Open Mic applicant — and every applicant on an admin-mapped form
 * that left the ID field out — was booked `missing_id_number` for a detail nobody
 * ever asked them for. The console prints that flag on every row, which is how it
 * ended up blamed for a review refusal that had nothing to do with it (PR #1173).
 *
 * Same bug class `account-prefill.ts` already documented for email:
 *   "no contest form collects an email — so before this every registration carried
 *    a `missing_email` fraud flag for a detail the account had all along."
 * That fix supplied the value; this one stops inventing the question.
 *
 * The asymmetry is deliberate and pinned below: the ID number is a contest-specific
 * field, so it follows the built form. Email and phone are account essentials —
 * no wizard step renders them (they come from sign-up), so making THOSE form-aware
 * would silently retire a real signal instead of a false one.
 *
 *   npm run test -- tests/unit/registration/fraud-flag-precision.spec.ts
 */
import { describe, expect, it } from 'vitest';
import { runBasicFraudChecks, fraudFlagsFor } from '@/src/features/registration/validation';
import { buildRegistrationSteps, registrationFormBuilders } from '@/src/features/registration/config';
import type { RegistrationDraft } from '@/src/features/registration/types';

function draft(overrides: Partial<RegistrationDraft> & { formData?: Record<string, unknown> } = {}): RegistrationDraft {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    reference: 'SPT-1-TEST',
    contestSlug: 'open-mic-competition',
    status: 'draft',
    role: 'public_user',
    createdAt: '2026-11-25T00:00:00.000Z',
    updatedAt: '2026-11-25T00:00:00.000Z',
    formData: {},
    completionPercent: 0,
    fraudFlags: [],
    ...overrides,
  } as RegistrationDraft;
}

const keysOf = (d: RegistrationDraft) =>
  new Set(buildRegistrationSteps(d).flatMap((s) => s.fields.map((f) => f.key)));

describe('missing_id_number follows the form the applicant was actually shown', () => {
  it('the census: only two hand-built forms collect an ID number, and neither requires it', () => {
    const collecting = Object.keys(registrationFormBuilders).filter((slug) =>
      keysOf(draft({ contestSlug: slug })).has('identity.idNumber'),
    );
    expect(collecting.sort()).toEqual(['film-academy', 'reality-tv-show']);

    // Neither one demands it, so a blank ID is not even a rule violation — which is
    // exactly why flagging it was noise rather than signal.
    for (const slug of collecting) {
      const field = buildRegistrationSteps(draft({ contestSlug: slug }))
        .flatMap((s) => s.fields)
        .find((f) => f.key === 'identity.idNumber');
      expect(field?.required, `${slug} must not make identity.idNumber required`).toBeFalsy();
    }

    // The default (capability-driven) form asks for no ID either, so any contest
    // outside the registry above was being flagged for a field nobody renders.
    expect(keysOf(draft({ contestSlug: 'some-brand-new-contest' })).has('identity.idNumber')).toBe(false);
  });

  it('an Open Mic applicant who never saw an ID field carries no missing_id_number', () => {
    const flags = runBasicFraudChecks(draft({
      contestSlug: 'open-mic-competition',
      formData: { 'personal.firstName': 'Ada', 'personal.lastName': 'Test' },
    }));
    expect(flags).not.toContain('missing_id_number');
  });

  it('a form that DOES ask for an ID number still flags a blank one', () => {
    const flags = runBasicFraudChecks(draft({
      contestSlug: 'reality-tv-show',
      formData: {
        'personal.firstName': 'Ada',
        'personal.lastName': 'Test',
        'personal.primaryPhone': '+2349000000000',
        // identity.idNumber is collected by this form and deliberately left blank
      },
    }));
    expect(flags).toContain('missing_id_number');
  });

  it('follows an admin-defined form schema, in both directions', () => {
    // An admin-mapped form that includes the ID field: its absence is meaningful.
    const asks = draft({
      contestSlug: 'stem-contest',
      formData: { 'derived.formSchema': { includedFields: ['identity.idNumber', 'personal.primaryPhone'] } },
    });
    expect(keysOf(asks).has('identity.idNumber')).toBe(true);
    expect(runBasicFraudChecks(asks)).toContain('missing_id_number');

    // The same contest with the ID field left out of the mapping: no flag.
    const skips = draft({
      contestSlug: 'stem-contest',
      formData: { 'derived.formSchema': { includedFields: ['personal.primaryPhone'] } },
    });
    expect(keysOf(skips).has('identity.idNumber')).toBe(false);
    expect(runBasicFraudChecks(skips)).not.toContain('missing_id_number');
  });

  it('email and phone stay unconditional — they are account data, not form fields', () => {
    // No built form renders these two keys, so "the form did not ask" would be a
    // permanent excuse here. Contactability is what the flag exists to catch.
    expect(keysOf(draft({ contestSlug: 'open-mic-competition' })).has('personal.email')).toBe(false);
    const flags = runBasicFraudChecks(draft({ contestSlug: 'open-mic-competition' }));
    expect(flags).toContain('missing_email');
    expect(flags).toContain('missing_phone');
  });

  it('an unresolvable form is treated as unknown, so the ID flag is never silently lost', () => {
    // Every real form yields fields, so this branch is a guard against a draft that
    // cannot be built at all (broken derived data). Unknown must fail loud.
    expect(fraudFlagsFor(draft({ contestSlug: 'open-mic-competition' }), null)).toContain('missing_id_number');
    expect(fraudFlagsFor(draft({ contestSlug: 'open-mic-competition' }), new Set(['personal.primaryPhone']))).not.toContain('missing_id_number');
  });

  it('never touches the underage check, which is derived rather than asked', () => {
    const flags = runBasicFraudChecks(draft({
      contestSlug: 'open-mic-competition',
      formData: {
        'derived.age': 15,
        'derived.legalAdultAge': 18,
        'guardian.consentGranted': false,
      },
    }));
    expect(flags).toContain('underage_without_guardian_consent');
  });
});
