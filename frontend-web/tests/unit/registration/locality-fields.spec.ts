// The locality tier has to reach the APPLICANT'S OWN FORM.
//
// Everything else that makes a "local contest" work was already in place: the
// console can scope a contest to an LGA or a village, `public.villages` holds the
// curated quarters, the BFF serves them, and both wizards know how to cascade
// state -> LGA -> village. But a contest form is assembled from
// `forms/<slug>.ts` (or an admin schema), and none of those templates listed
// `personal.localGovernment` / `personal.village` — so the cascade code had
// nothing to render and no roster row ever gained a quarter. That is the gap this
// file pins: the three keys must be present in the personal step of every built
// form, in cascade order, and still OPTIONAL, because the enforcement decision for
// locality is display + filter — nobody is boxed out of entering over where they
// live.
import { describe, expect, it } from 'vitest';
import { buildRegistrationSteps } from '@/src/features/registration/config';
import { ensureLocalityFields, LOCALITY_FIELD_KEYS } from '@/src/features/registration/locality-fields';
import type { RegistrationDraft, RegistrationStep } from '@/src/features/registration/types';

const ORIGIN = 'personal.stateOfOrigin';
const LGA = 'personal.localGovernment';
const VILLAGE = 'personal.village';

/** Every slug with a hand-built form, plus one that falls through to `default.ts`. */
const SLUGS = [
  'open-mic-competition',
  'reality-tv-show',
  'film-academy',
  'stem-contest',
  'sme-pitch-contest',
  'brand-new-contest-with-no-template',
];

function draftFor(
  formData: Record<string, unknown> = {},
  contestSlug = 'open-mic-competition',
): RegistrationDraft {
  return {
    id: 'draft-1',
    reference: 'SPOT-1',
    contestSlug,
    status: 'draft',
    role: 'public_user',
    createdAt: '',
    updatedAt: '',
    formData: { 'derived.age': 24, ...formData },
    completionPercent: 0,
    fraudFlags: [],
  };
}

function personal(steps: RegistrationStep[]) {
  const step = steps.find((s) => s.key === 'personal_information');
  if (!step) throw new Error('no personal_information step');
  return step;
}

function keysOf(step: RegistrationStep) {
  return step.fields.map((f) => f.key);
}

function fieldOf(step: RegistrationStep, key: string) {
  return step.fields.find((f) => f.key === key);
}

describe('locality fields — every built contest form asks for them', () => {
  it.each(SLUGS)('%s offers state of origin, LGA and village', (slug) => {
    const step = personal(buildRegistrationSteps(draftFor({}, slug)));
    for (const key of LOCALITY_FIELD_KEYS) expect(keysOf(step)).toContain(key);
  });

  it('keeps the cascade order: origin, then LGA, then village', () => {
    for (const slug of SLUGS) {
      const keys = keysOf(personal(buildRegistrationSteps(draftFor({}, slug))));
      expect(keys.indexOf(ORIGIN)).toBeLessThan(keys.indexOf(LGA));
      expect(keys.indexOf(LGA)).toBeLessThan(keys.indexOf(VILLAGE));
    }
  });

  it('asks for each key exactly once', () => {
    for (const slug of SLUGS) {
      const keys = keysOf(personal(buildRegistrationSteps(draftFor({}, slug))));
      for (const key of [ORIGIN, LGA, VILLAGE]) {
        expect(keys.filter((k) => k === key)).toHaveLength(1);
      }
    }
  });

  it('places the locality block with the geography, before the phone number', () => {
    // Injecting at the end of the step would scatter "where you are from" across
    // two screens' worth of fields; the block belongs next to residence/city.
    for (const slug of SLUGS) {
      const keys = keysOf(personal(buildRegistrationSteps(draftFor({}, slug))));
      expect(keys.indexOf(VILLAGE)).toBeLessThan(keys.indexOf('personal.primaryPhone'));
    }
  });
});

describe('locality fields — optional, and shaped for the cascade', () => {
  it('leaves LGA and village optional so nobody is blocked from entering', () => {
    for (const slug of SLUGS) {
      const step = personal(buildRegistrationSteps(draftFor({}, slug)));
      expect(fieldOf(step, LGA)?.required).toBeFalsy();
      expect(fieldOf(step, VILLAGE)?.required).toBeFalsy();
    }
  });

  it('offers the LGA as a select with no baked options — the wizard fills it from the origin', () => {
    // Options are computed at render (lgaOptionsFor) from the 37-state table, so a
    // static list here would be a second copy to keep in sync.
    const step = personal(buildRegistrationSteps(draftFor({}, 'open-mic-competition')));
    const lga = fieldOf(step, LGA);
    expect(lga?.type).toBe('select');
    expect(lga?.options ?? []).toEqual([]);
  });

  it('keeps the village a text field, never a select', () => {
    // Rule 3 of the cascade: an LGA with no curated quarters degrades to typing.
    // A select with no options is a dead control, so the field must be text-capable
    // in every contest, curated list or not.
    const step = personal(buildRegistrationSteps(draftFor({}, 'open-mic-competition')));
    expect(fieldOf(step, VILLAGE)?.type).toBe('text');
  });

  it('does not overwrite a template that already requires the state of origin', () => {
    // reality-tv-show and film-academy have always asked for origin and made it
    // required; the injector adds what is MISSING and leaves what is there alone.
    for (const slug of ['reality-tv-show', 'film-academy']) {
      const step = personal(buildRegistrationSteps(draftFor({}, slug)));
      const origin = fieldOf(step, ORIGIN);
      expect(origin?.required).toBe(true);
      expect((origin?.options ?? []).length).toBeGreaterThan(0);
    }
  });
});

describe('locality fields — the admin schema stays the operator\'s call', () => {
  it('does not add locality inputs the operator did not include', () => {
    // forms/from-schema.ts renders EXACTLY the catalog fields the console enabled.
    // Injecting here would put a question back that an operator turned off.
    const draft = draftFor(
      {
        'derived.formSchema': {
          version: 1,
          includedFields: ['personal.firstName', 'personal.lastName', 'personal.stateOfResidence'],
          customFields: [],
        },
      },
      'admin-built-contest',
    );
    const keys = keysOf(personal(buildRegistrationSteps(draft)));
    expect(keys).not.toContain(LGA);
    expect(keys).not.toContain(VILLAGE);
    expect(keys).not.toContain(ORIGIN);
  });

  it('honours a partial locality selection without completing it', () => {
    const draft = draftFor(
      {
        'derived.formSchema': {
          version: 1,
          includedFields: ['personal.firstName', 'personal.village'],
          customFields: [],
        },
      },
      'admin-built-contest',
    );
    const keys = keysOf(personal(buildRegistrationSteps(draft)));
    expect(keys).toContain(VILLAGE);
    expect(keys).not.toContain(ORIGIN);
    expect(keys).not.toContain(LGA);
  });
});

describe('ensureLocalityFields — the injector on its own', () => {
  const base = (): RegistrationStep[] => [
    {
      key: 'personal_information',
      title: 'Profile',
      description: '',
      fields: [
        { key: 'personal.firstName', label: 'First name', type: 'text', required: true },
        { key: 'personal.stateOfResidence', label: 'State of residence', type: 'select', required: true, options: ['Anambra'] },
        { key: 'personal.city', label: 'City / town', type: 'select', required: true, options: [] },
        { key: 'personal.primaryPhone', label: 'Phone', type: 'tel', required: true },
      ],
    },
    {
      key: 'category_specific',
      title: 'Category',
      description: '',
      fields: [{ key: 'category.genre', label: 'Genre', type: 'text', required: true }],
    },
  ];

  it('is idempotent: a second pass adds nothing', () => {
    const once = ensureLocalityFields(base(), draftFor());
    const twice = ensureLocalityFields(once, draftFor());
    expect(keysOf(personal(twice))).toEqual(keysOf(personal(once)));
  });

  it('returns the other steps untouched', () => {
    const steps = base();
    const out = ensureLocalityFields(steps, draftFor());
    expect(out[1]).toBe(steps[1]);
    expect(out).toHaveLength(steps.length);
  });

  it('never mutates the step it was given', () => {
    // The store caches step objects; rewriting `step.fields` in place would leak
    // locality fields into a draft built for a different contest.
    const steps = base();
    const before = keysOf(steps[0]);
    ensureLocalityFields(steps, draftFor());
    expect(keysOf(steps[0])).toEqual(before);
  });

  it('inserts after the city field when the step has no state of origin', () => {
    const step = personal(ensureLocalityFields(base(), draftFor()));
    const keys = keysOf(step);
    expect(keys.indexOf(ORIGIN)).toBe(keys.indexOf('personal.city') + 1);
  });

  it('inserts directly after an existing state of origin', () => {
    const steps: RegistrationStep[] = [
      {
        key: 'personal_information',
        title: 'Profile',
        description: '',
        fields: [
          { key: 'personal.firstName', label: 'First name', type: 'text', required: true },
          { key: ORIGIN, label: 'State of origin', type: 'select', required: true, options: ['Anambra'] },
          { key: 'personal.primaryPhone', label: 'Phone', type: 'tel', required: true },
        ],
      },
    ];
    const keys = keysOf(personal(ensureLocalityFields(steps, draftFor())));
    expect(keys).toEqual([
      'personal.firstName',
      ORIGIN,
      LGA,
      VILLAGE,
      'personal.primaryPhone',
    ]);
  });

  it('says which LGA the contest belongs to when the draft carries one', () => {
    // The operator's "local contest within a defined local government" has to be
    // legible to the applicant at the moment they answer, not only on the banner.
    const step = personal(
      ensureLocalityFields(
        base(),
        draftFor({ 'derived.localityScope': 'lga', 'derived.localityState': 'Anambra', 'derived.localityLga': 'Onitsha North' }),
      ),
    );
    expect(fieldOf(step, LGA)?.helpText).toContain('Onitsha North');
    expect(fieldOf(step, LGA)?.helpText).toContain('Anambra');
  });

  it('names the quarter too on a village-scoped contest', () => {
    const step = personal(
      ensureLocalityFields(
        base(),
        draftFor({
          'derived.localityScope': 'village',
          'derived.localityState': 'Anambra',
          'derived.localityLga': 'Onitsha North',
          'derived.localityVillage': 'Ogbendida',
        }),
      ),
    );
    expect(fieldOf(step, VILLAGE)?.helpText).toContain('Ogbendida');
  });

  it('keeps the catalog help text when the contest has no locality', () => {
    // Absent derived keys are the shape of every draft created before this feature,
    // and of every national contest — they read as "no hint", never as a blank note.
    const step = personal(ensureLocalityFields(base(), draftFor()));
    expect(fieldOf(step, LGA)?.helpText).toContain('state of origin');
  });

  it('adds the block to a step that has no geography fields at all', () => {
    const steps: RegistrationStep[] = [
      { key: 'personal_information', title: 'Profile', description: '', fields: [{ key: 'personal.firstName', label: 'First name', type: 'text', required: true }] },
    ];
    const keys = keysOf(personal(ensureLocalityFields(steps, draftFor())));
    expect(keys).toEqual(['personal.firstName', ORIGIN, LGA, VILLAGE]);
  });

  it('does nothing when there is no personal step to extend', () => {
    const steps: RegistrationStep[] = [
      { key: 'category_specific', title: 'Category', description: '', fields: [] },
    ];
    expect(ensureLocalityFields(steps, draftFor())).toBe(steps);
  });
});

describe('locality fields survive the rest of the pipeline', () => {
  it('keeps the account-prefill locking behaviour on the fields the account owns', () => {
    // ensureLocalityFields runs inside buildStepsForContest, BEFORE
    // markAccountProvidedFields. A name the account supplied stays locked (that
    // path only locks a key it also has a non-empty value for — see
    // account-prefill.ts), and a locality field this module injected never becomes
    // read-only: the account does not own an applicant's quarter.
    const draft = draftFor({
      'derived.accountProvidedKeys': ['personal.firstName', 'personal.lastName', 'personal.stateOfOrigin'],
      'personal.firstName': 'Ada',
      'personal.lastName': 'Okafor',
      'personal.stateOfOrigin': 'Anambra',
    });
    const step = personal(buildRegistrationSteps(draft));
    expect(fieldOf(step, 'personal.firstName')?.readOnly).toBe(true);
    expect(fieldOf(step, ORIGIN)?.readOnly).toBeFalsy();
    expect(fieldOf(step, LGA)?.readOnly).toBeFalsy();
    expect(fieldOf(step, VILLAGE)?.readOnly).toBeFalsy();
  });

  it('is a no-op for a draft whose steps already carry the trio', () => {
    const once = buildRegistrationSteps(draftFor());
    const twice = ensureLocalityFields(once, draftFor());
    expect(keysOf(personal(twice))).toEqual(keysOf(personal(once)));
  });
});
