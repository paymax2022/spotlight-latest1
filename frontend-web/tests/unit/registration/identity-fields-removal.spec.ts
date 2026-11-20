// The registration flow no longer collects a government ID from applicants.
//
// "Government-issued ID type" and "ID upload" used to be required inputs on the
// `category_specific` step of every registration form, on web and in the app.
// They are gone: no form module declares them, the admin field catalog cannot
// map them, and no preset seeds them.
//
// What these tests pin, in the order the removal could silently fail:
//   1. no built form anywhere carries the two keys — the applicant never sees
//      them, and a required field nobody renders is the dead end commit
//      2632266ac had to fix once already for payment.method;
//   2. the step the app's wizard submits actually SAVES without them, i.e. the
//      server-side validator no longer demands them (this is the load-bearing
//      assertion: hiding a field server-validated as required produces the
//      "complete the highlighted required fields" banner with nothing to
//      highlight);
//   3. the catalog and the per-category presets dropped them, so a contest
//      created tomorrow cannot ask again;
//   4. the two bespoke web wizards that rendered them as their own JSX stopped
//      validating, uploading, emitting and hydrating them.
//
//   npm run test -- tests/unit/registration/identity-fields-removal.spec.ts

import { describe, expect, it } from 'vitest';
import { buildRegistrationSteps } from '@/src/features/registration/config';
import { validateStepData } from '@/src/features/registration/validation';
import {
  CATEGORY_FIELD_PRESETS,
  FIELD_CATALOG,
  getCategoryFieldPreset,
} from '@/src/features/registration/field-catalog';
import { registrationFormBuilders } from '@/src/features/registration/forms';
import {
  REALITY_TV_UPLOAD_FIELDS,
  REALITY_TV_WIZARD_INITIAL,
  flatErrorKeyToFormKey,
  realityTvFieldOptions,
  realityTvWizardFormToFlat,
  validateRealityTvWizardStep,
  realityTvWizardSchemaErrors,
} from '@/src/features/registration/reality-tv-show-wizard-map';
import type { RegistrationDraft, RegistrationStep } from '@/src/features/registration/types';

const ID_KEYS = ['identity.idType', 'identity.idUpload'] as const;

function draftWith(formData: Record<string, unknown>, contestSlug = 'open-mic-dev'): RegistrationDraft {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    reference: 'SPT-1-TEST',
    contestSlug,
    status: 'draft',
    role: 'public_user',
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    formData,
    completionPercent: 0,
    fraudFlags: [],
  };
}

const allFields = (steps: RegistrationStep[]) => steps.flatMap((step) => step.fields.map((field) => field.key));

describe('government-ID fields are out of the registration schema', () => {
  it('no built form declares them — not the fallback, not a bespoke contest form', () => {
    const slugs = [...Object.keys(registrationFormBuilders), 'some-contest-created-tomorrow'];
    for (const slug of slugs) {
      const keys = allFields(buildRegistrationSteps(draftWith({}, slug)));
      for (const idKey of ID_KEYS) {
        expect(keys, `${slug} still declares ${idKey}`).not.toContain(idKey);
      }
    }
  });

  it('the catalog cannot map them and no preset seeds them', () => {
    for (const idKey of ID_KEYS) {
      expect(FIELD_CATALOG.find((entry) => entry.key === idKey), `${idKey} still in FIELD_CATALOG`).toBeUndefined();
    }
    const presets = [...Object.keys(CATEGORY_FIELD_PRESETS), 'a-category-nobody-has-added'];
    for (const category of presets) {
      const preset = getCategoryFieldPreset(category);
      for (const idKey of ID_KEYS) expect(preset, `${category} preset still seeds ${idKey}`).not.toContain(idKey);
    }
  });

  it('an admin schema that still lists them renders nothing', () => {
    // Stored templates are data: `derived.formSchema` snapshots and
    // contest_registration_templates rows can keep the keys after this change.
    // from-schema.ts builds from the catalog, so an unmapped key must vanish
    // rather than crash or fall back to a required input.
    const draft = draftWith({ 'derived.formSchema': { includedFields: [...ID_KEYS, 'media.profilePhoto'] } });
    const keys = allFields(buildRegistrationSteps(draft));
    for (const idKey of ID_KEYS) expect(keys).not.toContain(idKey);
    expect(keys).toContain('media.profilePhoto');
  });

  it('the step the app wizard submits saves with no ID collected', () => {
    // This is the reported screen: a `open-mic-dev` draft (no bespoke form, so
    // the capability-driven default form) reaching "Contest Requirements".
    // Everything the step still requires is filled; the two ID values are not.
    const formData = {
      'media.profilePhoto': { fileName: 'me.png', storageKey: 'registration/me.png' },
      'media.rightsConfirmed': true,
      'compliance.codeOfConductAgreement': true,
      'compliance.truthDeclaration': true,
    };
    const steps = buildRegistrationSteps(draftWith(formData));
    const step = steps.find((item) => item.key === 'category_specific');
    expect(step, 'default form lost its category_specific step').toBeDefined();
    expect(validateStepData(step!, formData)).toEqual({ isValid: true, errors: {} });
  });

  it('neither form module nor the default form asks for an ID any more', () => {
    // Guards the shape of the removal, not just the keys: a leftover
    // `identityFields` array re-spread into a later step would reappear.
    const steps = buildRegistrationSteps(draftWith({}));
    const labels = steps.flatMap((step) => step.fields.map((field) => field.label));
    expect(labels.filter((label) => /government-issued id/i.test(label))).toEqual([]);
    expect(labels.filter((label) => /^id upload$/i.test(label))).toEqual([]);
  });
});

describe('bespoke reality-tv web wizard', () => {
  // An adult who has collected no ID at all. Deliberately built from the
  // wizard's own initial state so this spec keeps compiling once the ID slots
  // leave RealityTvWizardForm — it asserts the ABSENCE of ID errors, not the
  // presence of ID fields.
  const adultWithoutId = () => ({
    ...REALITY_TV_WIZARD_INITIAL,
    personal_dateOfBirth: '1995-04-04',
    category_uniqueStory: 'Authentic, watchable, unfiltered',
  });

  it('offers no ID options and no ID upload slot', () => {
    expect(realityTvFieldOptions('identity.idType')).toEqual([]);
    expect(REALITY_TV_UPLOAD_FIELDS).not.toContain('identity.idUpload');
  });

  it('step 3 no longer demands an ID type or an ID upload', () => {
    const errors = validateRealityTvWizardStep(3, adultWithoutId());
    expect(errors).not.toHaveProperty('identity_idType');
    expect(errors).not.toHaveProperty('identity_idUploadUrl');
  });

  it('the schema mirror of step 3 no longer reports them either', () => {
    const errors = realityTvWizardSchemaErrors(adultWithoutId());
    expect(errors).not.toHaveProperty('identity.idType');
    expect(errors).not.toHaveProperty('identity.idUpload');
  });

  it('stops emitting them into the saved payload and stops mapping their errors', () => {
    const flat = realityTvWizardFormToFlat(adultWithoutId(), {});
    expect(flat).not.toHaveProperty('identity.idType');
    expect(flat).not.toHaveProperty('identity.idUpload');
    // The generic dot→snake transform stays; the ID-specific override goes.
    expect(flatErrorKeyToFormKey('media.introVideo')).toBe('media_introVideoUrl');
  });
});
