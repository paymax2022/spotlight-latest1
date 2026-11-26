/**
 * Locality cascade: state of origin -> local government -> village.
 *
 * WHAT THIS LOCKS DOWN, and why each half is where it is:
 *
 * 1. The LGA list is STATIC (NIGERIA_LGAS_BY_STATE). `NIGERIA_CITIES_BY_STATE`
 *    has always held the 774 LGAs while its key and the wizard label said
 *    "city / town"; the alias names it correctly without touching the eight
 *    existing readers. Pair validation for origin -> LGA therefore needs no
 *    server, exactly like the residence -> city pair already does.
 *
 * 2. The VILLAGE list is CURATED DATA IN POSTGRES (public.villages, added by
 *    20272000000000) and reaches the form through /api/registration/villages.
 *    Bundling it in the app would mean a redeploy for every quarter an admin
 *    adds, so the web wizard reads the same table the phone reads.
 *
 * 3. A village is NOT hard-validated, and that is deliberate rather than an
 *    oversight. Only Onitsha North has rows; on the other 773 LGAs the field is
 *    free text by design, and the user's enforcement decision for locality was
 *    display + filter only — nobody is blocked from entering or voted over by
 *    where they live. An applicant whose quarter is spelled a second way must
 *    still be able to apply.
 */
import { describe, it, expect } from 'vitest';

import {
  NIGERIA_LGAS_BY_STATE,
  NIGERIA_CITIES_BY_STATE,
} from '@/src/features/registration/reference-data';
import { validateStepData } from '@/src/features/registration/validation';
import { FIELD_CATALOG } from '@/src/features/registration/field-catalog';
import { localityArgs, villagesPayload } from '@/src/server/registration-v2/locality';
import type { RegistrationStep } from '@/src/features/registration/types';

const personalStep: RegistrationStep = {
  key: 'personal_information',
  title: 'Personal information',
  description: '',
  fields: [
    { key: 'personal.stateOfOrigin', label: 'State of origin', type: 'select', options: ['Anambra', 'Lagos'] },
    { key: 'personal.localGovernment', label: 'Local government', type: 'select', options: [] },
    { key: 'personal.village', label: 'Village / quarter', type: 'text' },
  ],
};

describe('LGA reference data', () => {
  it('names the LGA map for what it holds, and keeps the old key alive', () => {
    expect(NIGERIA_LGAS_BY_STATE).toBe(NIGERIA_CITIES_BY_STATE);
    expect(NIGERIA_LGAS_BY_STATE.Anambra).toContain('Onitsha North');
    expect(NIGERIA_LGAS_BY_STATE.Anambra).toContain('Onitsha South');
  });
});

describe('field catalog exposes the locality tier', () => {
  const lga = FIELD_CATALOG.find((f) => f.key === 'personal.localGovernment');
  const village = FIELD_CATALOG.find((f) => f.key === 'personal.village');

  it('offers local government on the personal step', () => {
    expect(lga).toBeDefined();
    expect(lga?.step).toBe('personal_information');
    // Options arrive at runtime from the cascade; an empty list is the same
    // shape the existing city field uses.
    expect(lga?.type).toBe('select');
    expect(lga?.options ?? []).toEqual([]);
  });

  it('offers village as a text-capable field so an uncurated LGA is still answerable', () => {
    expect(village).toBeDefined();
    expect(village?.step).toBe('personal_information');
    expect(['text', 'select']).toContain(village?.type);
  });
});

describe('origin -> LGA pair validation', () => {
  it('accepts an LGA that belongs to the selected state of origin', () => {
    const res = validateStepData(personalStep, {
      'personal.stateOfOrigin': 'Anambra',
      'personal.localGovernment': 'Onitsha North',
      'personal.village': 'Ogbendida',
    });
    expect(res.errors['personal.localGovernment']).toBeUndefined();
  });

  it('rejects an LGA that belongs to a different state, and names the state', () => {
    const res = validateStepData(personalStep, {
      'personal.stateOfOrigin': 'Anambra',
      'personal.localGovernment': 'Ewekoro',
    });
    expect(res.errors['personal.localGovernment']).toContain('Anambra');
  });

  it('skips the pair check for a state with no LGA list, so no applicant is boxed in', () => {
    // The existing state/city pairs already behave this way. A state the
    // reference table does not cover must fall open: the answer is stored, not
    // rejected, and the admin sees what was typed.
    const looseStep: RegistrationStep = {
      key: 'personal_information',
      title: 'Personal information',
      description: '',
      fields: [
        { key: 'personal.stateOfOrigin', label: 'State of origin', type: 'text' },
        { key: 'personal.localGovernment', label: 'Local government', type: 'select', options: [] },
      ],
    };
    const res = validateStepData(looseStep, {
      'personal.stateOfOrigin': 'Somewhere Not In The Table',
      'personal.localGovernment': 'Any LGA At All',
    });
    expect(res.errors['personal.localGovernment']).toBeUndefined();
  });
});

describe('village is never a submission blocker', () => {
  it('accepts a typed village with no LGA selected at all', () => {
    const res = validateStepData(personalStep, { 'personal.village': 'Family compound, Oha' });
    expect(res.errors['personal.village']).toBeUndefined();
  });

  it('accepts a village the curated list does not contain', () => {
    const res = validateStepData(personalStep, {
      'personal.stateOfOrigin': 'Anambra',
      'personal.localGovernment': 'Onitsha North',
      'personal.village': 'Ogbenda', // a plausible alternate spelling
    });
    expect(res.errors['personal.village']).toBeUndefined();
  });
});

describe('locality arguments', () => {
  it('requires both, and names the one that is missing', () => {
    expect(localityArgs(null, 'Onitsha North').error).toContain('state');
    expect(localityArgs('Anambra', '').error).toContain('lga');
    expect(localityArgs('Anambra', '   ').error).toContain('lga');
  });

  it('trims and accepts a real pair', () => {
    const got = localityArgs('  Anambra ', 'Onitsha North\n');
    expect(got.error).toBeUndefined();
    expect(got.state).toBe('Anambra');
    expect(got.lga).toBe('Onitsha North');
  });

  it('refuses an absurdly long locality string before it reaches the database', () => {
    expect(localityArgs('A'.repeat(300), 'Onitsha North').error).toContain('state');
  });
});

describe('villages payload', () => {
  it('marks a curated list and keeps the names in order', () => {
    const payload = villagesPayload('Anambra', 'Onitsha North', ['Ogbendida', 'Isiokwe']);
    expect(payload.mode).toBe('curated');
    expect(payload.villages).toEqual(['Ogbendida', 'Isiokwe']);
    expect(payload.state).toBe('Anambra');
    expect(payload.lga).toBe('Onitsha North');
  });

  it('reports free_text rather than an error when the LGA has no curated villages', () => {
    const payload = villagesPayload('Anambra', 'Onitsha South', []);
    expect(payload.mode).toBe('free_text');
    // [] not null: the picker maps over it.
    expect(payload.villages).toEqual([]);
  });
});
