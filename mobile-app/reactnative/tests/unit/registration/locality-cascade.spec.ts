// Pure-logic unit tests for the phone's half of the locality cascade.
//
// WHY THIS EXISTS ON MOBILE AT ALL. The registration form is schema-driven and the
// server ships `personal.localGovernment` as a select with EMPTY options and
// `personal.village` as a plain text box — exactly the shape `personal.city` had
// before `cityOptions.ts` wired it (see that file's header: "city is not fetched").
// Without these rules the phone asks an applicant for their village as a free-text
// box on a local contest, so the quarter nobody spelled the same way twice is the
// data the locality filters are supposed to run on.
//
// The three rules below are the same three the web wizard enforces
// (frontend-web/src/features/registration/locality-picker.ts), restated for the
// phone rather than imported, because the two packages share no runtime and the
// mobile suite runs under `node --test`:
//
//   1. LGA options follow the STATE OF ORIGIN — residence keeps driving the city
//      pickers it already drives, since those two geographies answer different
//      questions and the locality filters are built from origin;
//   2. changing a level clears everything below it, so a saved row can never read
//      "Onitsha North / Ikeja";
//   3. a missing, empty, or failed village list degrades to a plain text box — never
//      an error the applicant has to dismiss. Only some LGAs have curated quarters.
//
// The module takes its HTTP reader as an argument instead of importing the axios
// client, which is what keeps this file runnable: `@/api/client` pulls in
// async-storage and the RN network stack, and the rules are the part worth pinning.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_GOVERNMENT_KEY,
  STATE_OF_ORIGIN_KEY,
  VILLAGE_KEY,
  lgaOptionsFor,
  loadVillageChoices,
  localityResetsFor,
  parseVillagesResponse,
  villagesUrl,
  villageSuggestionsFor,
  withLocalityOptions,
  type VillagesChoice,
} from '@/features/registration/utils/localityOptions';
import type { RegistrationField } from '@/features/registration/types/registration.types';

function field(over: Partial<RegistrationField>): RegistrationField {
  return {
    key: 'personal.firstName',
    label: 'First name',
    type: 'text',
    required: false,
    readOnly: false,
    placeholder: '',
    options: [],
    ...over,
  } as RegistrationField;
}

const lgaField = field({ key: LOCAL_GOVERNMENT_KEY, label: 'Local government (LGA)', type: 'select' });
const villageField = field({ key: VILLAGE_KEY, label: 'Village / quarter', type: 'text' });

const CURATED = {
  success: true,
  state: 'Anambra',
  lga: 'Onitsha North',
  mode: 'curated',
  villages: ['Isiokwe', 'Mgbelekeke', 'Ogbendida'],
};

describe('locality cascade — LGA options', () => {
  it('offers the LGAs of the state of origin in the spelling the server validates', () => {
    const lgas = lgaOptionsFor('Anambra');
    assert.ok(lgas.includes('Onitsha North'), 'Onitsha North must be offered, not typed');
    assert.ok(lgas.includes('Onitsha South'));
    assert.equal(lgas.length, 21);
  });

  it('resolves the FCT label the server sends to this dataset key', () => {
    // The origin options come from the server's state list, which says "FCT Abuja"
    // while src/data/nigeria.ts keys the same place "FCT - Abuja". Without the alias
    // the LGA box is simply empty for the FCT, which reads as "no LGAs exist there".
    assert.ok(lgaOptionsFor('FCT Abuja').includes('Abaji'));
  });

  it('offers nothing for a blank, unknown, or non-string state', () => {
    assert.deepEqual(lgaOptionsFor(''), []);
    assert.deepEqual(lgaOptionsFor(undefined), []);
    assert.deepEqual(lgaOptionsFor('Atlantis'), []);
  });
});

describe('locality cascade — resetting the levels below', () => {
  it('clears the LGA and the village when the state of origin moves', () => {
    const resets = localityResetsFor(STATE_OF_ORIGIN_KEY, {
      [STATE_OF_ORIGIN_KEY]: 'Anambra',
      [LOCAL_GOVERNMENT_KEY]: 'Onitsha North',
      [VILLAGE_KEY]: 'Ogbendida',
    }, 'Lagos');
    assert.deepEqual(resets, { [LOCAL_GOVERNMENT_KEY]: '', [VILLAGE_KEY]: '' });
  });

  it('keeps the answer when the same state is picked again', () => {
    // Re-selecting the value the field already holds must not throw away a village
    // the applicant typed — a reset keyed on "this field changed" rather than "this
    // field changed TO something else" loses data on a double tap.
    const resets = localityResetsFor(STATE_OF_ORIGIN_KEY, {
      [STATE_OF_ORIGIN_KEY]: 'Anambra',
      [LOCAL_GOVERNMENT_KEY]: 'Onitsha North',
      [VILLAGE_KEY]: 'Ogbendida',
    }, 'Anambra');
    assert.deepEqual(resets, {});
  });

  it('clears only the village when the LGA moves', () => {
    const resets = localityResetsFor(LOCAL_GOVERNMENT_KEY, {
      [STATE_OF_ORIGIN_KEY]: 'Anambra',
      [LOCAL_GOVERNMENT_KEY]: 'Onitsha North',
      [VILLAGE_KEY]: 'Ogbendida',
    }, 'Awka South');
    assert.deepEqual(resets, { [VILLAGE_KEY]: '' });
  });

  it('leaves every other field alone', () => {
    const resets = localityResetsFor('personal.firstName', {}, 'Tobi');
    assert.deepEqual(resets, {});
  });
});

describe('locality cascade — the published village list', () => {
  it('keys the query on both levels and encodes them', () => {
    const url = villagesUrl('Anambra', 'Oji River');
    assert.ok(url.startsWith('/api/registration/villages?'), 'the phone reads the BFF, not Go');
    assert.match(url, /state=Anambra/);
    assert.match(url, /lga=Oji%20River/);
  });

  it('reads a curated list, trimmed', () => {
    assert.deepEqual(parseVillagesResponse(CURATED), { mode: 'curated', villages: ['Isiokwe', 'Mgbelekeke', 'Ogbendida'] });
    assert.deepEqual(
      parseVillagesResponse({ ...CURATED, villages: [' Ogbendida ', 'Ogbeotu'] }),
      { mode: 'curated', villages: ['Ogbendida', 'Ogbeotu'] },
    );
  });

  // Every unreadable shape answers free text, because "let them type it" is the only
  // safe reading: guessing the other way hides a real list behind a text box, and an
  // error body is not something an applicant can act on.
  it('falls open for an uncurated LGA, an empty list, and any shape it does not recognise', () => {
    const free = { mode: 'free_text', villages: [] };
    assert.deepEqual(parseVillagesResponse({ success: true, state: 'Anambra', lga: 'Nkanu East', mode: 'free_text', villages: [] }), free);
    assert.deepEqual(parseVillagesResponse({ ...CURATED, villages: [] }), free);
    assert.deepEqual(parseVillagesResponse({ ...CURATED, success: false }), free);
    assert.deepEqual(parseVillagesResponse({ ...CURATED, mode: 'maybe' }), free);
    assert.deepEqual(parseVillagesResponse({ ...CURATED, villages: [{ name: 'Ogbendida' }] }), free);
    assert.deepEqual(parseVillagesResponse({ ...CURATED, villages: ['', 'Ogbendida'] }), free);
    assert.deepEqual(parseVillagesResponse(null), free);
    assert.deepEqual(parseVillagesResponse('nope'), free);
  });

  it('asks the server only when both levels are known', async () => {
    const seen: string[] = [];
    const get = async (url: string) => { seen.push(url); return CURATED; };
    assert.deepEqual(await loadVillageChoices('', 'Onitsha North', get), { mode: 'free_text', villages: [] });
    assert.deepEqual(await loadVillageChoices('Anambra', '  ', get), { mode: 'free_text', villages: [] });
    assert.deepEqual(seen, [], 'a half-chosen pair is not a question worth sending');
  });

  it('turns a failure into a text box instead of a thrown error', async () => {
    const get = async () => { throw new Error('Network request failed'); };
    assert.deepEqual(await loadVillageChoices('Anambra', 'Onitsha North', get), { mode: 'free_text', villages: [] });
  });

  it('returns the published quarters when they are there', async () => {
    const choice = await loadVillageChoices('Anambra', 'Onitsha North', async (url) => {
      assert.match(url, /lga=Onitsha%20North/);
      return CURATED;
    });
    assert.equal(choice.mode, 'curated');
    assert.ok(choice.villages.includes('Ogbendida'));
  });
});

describe('locality cascade — the fields the wizard renders', () => {
  const valueFor = (values: Record<string, unknown>) => (key: string) => values[key];
  const freeText: VillagesChoice = { mode: 'free_text', villages: [] };
  const curated: VillagesChoice = { mode: 'curated', villages: ['Ogbendida', 'Ogbeotu'] };

  it('fills the LGA select from the chosen state of origin', () => {
    const out = withLocalityOptions(lgaField, valueFor({ [STATE_OF_ORIGIN_KEY]: 'Anambra' }), freeText);
    assert.ok((out.options ?? []).includes('Onitsha North'));
    assert.equal(out.type, 'select');
  });

  it('says why the LGA box is empty before a state is picked', () => {
    const out = withLocalityOptions(lgaField, valueFor({}), freeText);
    assert.deepEqual(out.options, []);
    assert.match(out.placeholder ?? '', /state of origin/i);
  });

  it('offers the published quarters as suggestions on the village box', () => {
    const out = withLocalityOptions(villageField, valueFor({ [LOCAL_GOVERNMENT_KEY]: 'Onitsha North' }), curated);
    // Stays a text field: a quarter spelled differently at home has to stay typeable.
    assert.equal(out.type, 'text');
    assert.deepEqual(out.options, ['Ogbendida', 'Ogbeotu']);
  });

  it('leaves the village box untouched when the LGA is not curated', () => {
    const out = withLocalityOptions(villageField, valueFor({ [LOCAL_GOVERNMENT_KEY]: 'Nkanu East' }), freeText);
    assert.equal(out.type, 'text');
    assert.deepEqual(out.options, []);
    assert.equal(out.placeholder, villageField.placeholder);
  });

  it('passes every other field through untouched', () => {
    const firstName = field({ key: 'personal.firstName' });
    assert.equal(withLocalityOptions(firstName, () => 'Anambra', curated), firstName);
    const city = field({ key: 'personal.city', type: 'select' });
    assert.equal(withLocalityOptions(city, () => 'Anambra', curated), city);
  });
});

describe('locality cascade — what the renderer may turn into pills', () => {
  // FieldRenderer reads this instead of testing `field.options.length` itself: no
  // other field in the schema is allowed to grow suggestions just because somebody
  // filled its options, and a select already renders its options as a picker.
  it('shows suggestions only on the village box', () => {
    assert.deepEqual(
      villageSuggestionsFor(field({ key: VILLAGE_KEY, options: ['Ogbendida', 'Ogbeotu'] })),
      ['Ogbendida', 'Ogbeotu'],
    );
    assert.deepEqual(villageSuggestionsFor(field({ key: 'personal.city', type: 'select', options: ['Onitsha'] })), []);
    assert.deepEqual(villageSuggestionsFor(field({ key: VILLAGE_KEY, options: [] })), []);
    assert.deepEqual(villageSuggestionsFor(field({ key: VILLAGE_KEY })), []);
  });
});
