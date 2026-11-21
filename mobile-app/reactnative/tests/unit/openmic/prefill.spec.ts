// Prefill is a convenience, never a dependency: the answers come from the
// artist's own registration, and if that read fails the form must still open
// blank and submittable. A mistyped stage name is what the server's duplicate
// check compares, so getting it right the first time is the actual reason this
// mapping exists.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_PREFILL,
  handinFieldsOnRecord,
  identityFromUser,
  pickOpenMicApplication,
  prefillFromRegistrationFormData,
  withPrefillDefaults,
} from '@/features/openmic/prefill';
import { looksLikeOpenMicSlug } from '@/features/openmic/constants';
import type { RegistrationDraft } from '@/features/registration/types/registration.types';

function draft(over: Partial<RegistrationDraft>): RegistrationDraft {
  return {
    id: 'r1',
    reference: 'OM-1',
    contestSlug: 'open-mic-2026',
    status: 'approved',
    role: 'contestant',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    formData: {},
    completionPercent: 100,
    fraudFlags: [],
    ...over,
  };
}

describe('prefillFromRegistrationFormData', () => {
  it('maps the keys the Open Mic registration actually writes', () => {
    const out = prefillFromRegistrationFormData({
      'personal.stageName': 'Laja  ',
      'personal.firstName': 'Ade',
      'personal.lastName': 'Bello',
      'contact.email': 'ade@example.com ',
      'personal.stateOfResidence': 'Lagos',
      'personal.city': 'Ikeja',
      'category.genre': 'Afrobeats',
      'social.instagram': '@laja',
      'social.tiktok': '@lajaTT',
    });
    assert.equal(out.stageName, 'Laja');
    assert.equal(out.realName, 'Ade Bello');
    assert.equal(out.email, 'ade@example.com');
    assert.equal(out.state, 'Lagos');
    // The registration has no LGA question, so the city is offered as a starting
    // point and the artist confirms it against the cascade.
    assert.equal(out.lga, 'Ikeja');
    assert.equal(out.genre, 'Afrobeats');
    assert.equal(out.instagramHandle, '@laja');
    assert.equal(out.tiktokHandle, '@lajaTT');
  });

  it('falls back to the personal email and the handle-named social keys', () => {
    const out = prefillFromRegistrationFormData({
      'personal.email': 'p@x.com',
      'social.instagramHandle': 'hand1',
      'social.tiktokHandle': 'hand2',
    });
    assert.equal(out.email, 'p@x.com');
    assert.equal(out.instagramHandle, 'hand1');
    assert.equal(out.tiktokHandle, 'hand2');
  });

  it('prefers contact.email when both exist', () => {
    const out = prefillFromRegistrationFormData({
      'contact.email': 'contact@x.com',
      'personal.email': 'personal@x.com',
    });
    assert.equal(out.email, 'contact@x.com');
  });

  it('prefers an explicit LGA over the city', () => {
    const out = prefillFromRegistrationFormData({ 'personal.lga': 'Yaba', 'personal.city': 'Ikeja' });
    assert.equal(out.lga, 'Yaba');
  });

  it('builds a stage name from the real names when the entry has none', () => {
    const out = prefillFromRegistrationFormData({ 'personal.firstName': 'Ade', 'personal.lastName': 'Bello' });
    assert.equal(out.stageName, 'Ade Bello');
    assert.equal(out.realName, 'Ade Bello');
  });

  it('omits an answer it does not have instead of writing an empty string', () => {
    // The form seeds only non-empty values, so a key that is absent here stays
    // whatever the artist typed.
    const out = prefillFromRegistrationFormData({ 'personal.stageName': '   ' });
    assert.equal('stageName' in out, false);
    assert.equal('email' in out, false);
    assert.deepEqual(out, {});
  });

  it('reads a multi-select array as its first usable answer', () => {
    const out = prefillFromRegistrationFormData({ 'category.genre': ['', 'Hip-Hop', 'R&B'] });
    assert.equal(out.genre, 'Hip-Hop');
  });

  it('never prefills from an uploaded file value', () => {
    // An audition clip is stored as { url, fileName } — an object, and an array
    // of objects when the field allows several. Nothing in the hand-in form
    // should pick either up as text.
    const out = prefillFromRegistrationFormData({
      'personal.stageName': { url: 'https://x/y.mp4', fileName: 'audition.mp4' },
      'category.genre': [{ url: 'https://x/z.mp4', fileName: 'clip.mp4' }],
    });
    assert.equal('stageName' in out, false);
    assert.equal('genre' in out, false);
  });

  it('tolerates a missing or malformed form_data', () => {
    assert.deepEqual(prefillFromRegistrationFormData(undefined), {});
    assert.deepEqual(prefillFromRegistrationFormData(null), {});
    assert.deepEqual(prefillFromRegistrationFormData('nope' as unknown as Record<string, unknown>), {});
  });

  it('ignores numbers and booleans instead of stringifying them into a field', () => {
    const out = prefillFromRegistrationFormData({ 'personal.stageName': 42, 'category.genre': true });
    assert.deepEqual(out, {});
  });
});

describe('withPrefillDefaults', () => {
  it('fills every key so a caller never renders undefined', () => {
    const out = withPrefillDefaults(null);
    assert.deepEqual(out, EMPTY_PREFILL);
    assert.equal(out.country, 'Nigeria');
  });

  it('keeps the sparse answers it was given', () => {
    const out = withPrefillDefaults({ stageName: 'Laja', email: 'a@b.c' });
    assert.equal(out.stageName, 'Laja');
    assert.equal(out.email, 'a@b.c');
    assert.equal(out.state, '');
    assert.equal(out.country, 'Nigeria');
  });
});

describe('pickOpenMicApplication', () => {
  it('matches the edition by slug', () => {
    const wanted = draft({ id: 'a', contestSlug: 'open-mic-2026' });
    const other = draft({ id: 'b', contestSlug: 'arena-search' });
    const picked = pickOpenMicApplication([other, wanted], 'open-mic-2026', looksLikeOpenMicSlug);
    assert.equal(picked?.id, 'a');
  });

  it('accepts the Open Mic aliases an older entry carries', () => {
    const legacy = draft({ id: 'old', contestSlug: 'open-mic-competition' });
    const picked = pickOpenMicApplication([legacy], 'spotlight-open-mic-2026-11', looksLikeOpenMicSlug);
    assert.equal(picked?.id, 'old');
  });

  it('takes the most recently updated when several match', () => {
    // That is the row the reviewer last touched, so it is the one whose answers
    // the hand-in should reuse.
    const older = draft({ id: 'old', updatedAt: '2026-09-01T00:00:00Z' });
    const newer = draft({ id: 'new', updatedAt: '2026-11-01T00:00:00Z' });
    const picked = pickOpenMicApplication([older, newer], 'open-mic-2026', looksLikeOpenMicSlug);
    assert.equal(picked?.id, 'new');
    const reversed = pickOpenMicApplication([newer, older], 'open-mic-2026', looksLikeOpenMicSlug);
    assert.equal(reversed?.id, 'new');
  });

  it('returns null when nothing is an Open Mic entry', () => {
    const nope = draft({ contestSlug: 'arena-search' });
    assert.equal(pickOpenMicApplication([nope], 'open-mic-2026', () => false), null);
    assert.equal(pickOpenMicApplication([], 'open-mic-2026', looksLikeOpenMicSlug), null);
    assert.equal(pickOpenMicApplication(undefined, 'open-mic-2026', looksLikeOpenMicSlug), null);
  });

  it('skips a draft with no slug instead of matching it loosely', () => {
    const blank = draft({ id: 'blank', contestSlug: '' });
    const real = draft({ id: 'real', contestSlug: 'open-mic-2026' });
    const picked = pickOpenMicApplication([blank, real], 'open-mic-2026', looksLikeOpenMicSlug);
    assert.equal(picked?.id, 'real');
    assert.equal(pickOpenMicApplication([blank], 'open-mic-2026', () => true), null);
  });

  it('survives an unparsable updatedAt', () => {
    const broken = draft({ id: 'broken', updatedAt: 'yesterday' });
    const dated = draft({ id: 'dated', updatedAt: '2026-01-01T00:00:00Z' });
    const picked = pickOpenMicApplication([broken, dated], 'open-mic-2026', looksLikeOpenMicSlug);
    assert.equal(picked?.id, 'dated');
  });
});

describe('identityFromUser', () => {
  it('reads the account the session bearer actually has', () => {
    const out = identityFromUser({ id: 'u1', email: 'A@B.com', user_metadata: { fullName: 'Ade Bello' } });
    assert.deepEqual(out, { userId: 'u1', email: 'A@B.com', displayName: 'Ade Bello' });
  });

  it('tries each metadata name the auth plane has used', () => {
    for (const key of ['fullName', 'full_name', 'name', 'display_name']) {
      const out = identityFromUser({ id: 'u', user_metadata: { [key]: 'Stagey' } });
      assert.equal(out.displayName, 'Stagey', key);
    }
  });

  it('hands back blanks rather than guessing a name', () => {
    const out = identityFromUser(null);
    assert.deepEqual(out, { userId: '', email: '', displayName: '' });
    assert.deepEqual(identityFromUser(undefined), { userId: '', email: '', displayName: '' });
  });

  it('tolerates a user with no metadata', () => {
    const out = identityFromUser({ id: 'u9', email: 'x@y.z' });
    assert.equal(out.userId, 'u9');
    assert.equal(out.displayName, '');
  });
});

describe('handinFieldsOnRecord', () => {
  // The hand-in used to ask these three facts as if the artist had never given
  // them: the email comes from the account they signed up with, and the state
  // and LGA are the answers on their own approved entry. Inheriting them is only
  // safe when the record holds a value this form could itself have produced —
  // anything else has to stay a question, because a locked field the artist
  // cannot correct is worse than an extra tap.

  it('inherits the email and the state/LGA pair a real approved entry carries', () => {
    // Anambra / Awka North is the live dev record behind
    // registrations 8977dc4a-630c-4658-9967-120dfbad1e44.
    const out = handinFieldsOnRecord(
      prefillFromRegistrationFormData({
        'personal.stateOfResidence': 'Anambra',
        'personal.city': 'Awka North',
        'personal.email': 'spec.ng+openmic@gmail.com',
      }),
    );
    assert.deepEqual(out, { email: true, location: true });
  });

  it('counts the account email as on record when the entry never collected one', () => {
    const out = handinFieldsOnRecord(EMPTY_PREFILL, 'ada@example.com');
    assert.equal(out.email, true);
  });

  it('asks for the email when neither the entry nor the account has one', () => {
    assert.equal(handinFieldsOnRecord(EMPTY_PREFILL, '').email, false);
    assert.equal(handinFieldsOnRecord(EMPTY_PREFILL, '   ').email, false);
    assert.equal(handinFieldsOnRecord(undefined, undefined).email, false);
  });

  it('asks again when the stored state is not one this form can offer', () => {
    // The LGA select cascades off the dataset's own spelling, so 'Lagos State'
    // would lock the pair to a state the artist can never re-select.
    const out = handinFieldsOnRecord({ state: 'Lagos State', lga: 'Ikeja' });
    assert.equal(out.location, false);
  });

  it('asks again when the stored LGA does not belong to the stored state', () => {
    const out = handinFieldsOnRecord({ state: 'Abia', lga: 'Ikeja' });
    assert.equal(out.location, false);
  });

  it('asks for the location when either half is missing', () => {
    assert.equal(handinFieldsOnRecord({ state: 'Lagos', lga: '' }).location, false);
    assert.equal(handinFieldsOnRecord({ state: '', lga: 'Ikeja' }).location, false);
    assert.equal(handinFieldsOnRecord(EMPTY_PREFILL).location, false);
  });

  it('inherits the pair when an explicit LGA answer exists', () => {
    const out = handinFieldsOnRecord(
      prefillFromRegistrationFormData({
        'personal.stateOfResidence': 'Lagos',
        'personal.lga': 'Yaba',
        'personal.city': 'Ikeja',
      }),
    );
    // Yaba is not a Lagos LGA, so the explicit answer still cannot be inherited.
    assert.equal(out.location, false);
    const valid = handinFieldsOnRecord(
      prefillFromRegistrationFormData({ 'personal.stateOfResidence': 'Lagos', 'personal.lga': 'Ikeja' }),
    );
    assert.equal(valid.location, true);
  });

  it('tolerates a missing or malformed prefill without throwing', () => {
    assert.deepEqual(handinFieldsOnRecord(null, null as unknown as string), { email: false, location: false });
    assert.deepEqual(handinFieldsOnRecord(undefined, undefined), { email: false, location: false });
  });
});
