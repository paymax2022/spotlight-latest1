// The hand-in form may only replace a question with a confirmed answer when the
// answer is actually on record — and for the location pair, when it is an answer
// this form itself could have produced.
//
// WHY THIS RULE EXISTS
// `POST /api/open-mic/submissions` needs country, state and LGA, and the Open Mic
// registration already asked for them (`personal.stateOfResidence` plus the
// `personal.city` select, which validation.ts:195 checks against the same LGA list
// this form cascades from). An artist arriving at `/open-mic/<slug>/enter` after
// being approved was still faced with three required selects and an email field,
// which is where entries get abandoned or mistyped. This module answers "is there
// anything left to ask?" so the page can show the answer instead of the question.
//
// The pairing check is the whole safety of the change: an LGA that does not belong
// to the stored state (a stale or foreign spelling, or a city typed when the list
// was open) would otherwise render as a confirmed row whose submit body cannot be
// corrected without pressing "Change". `getOpenMicLgaOptions` fails closed for an
// unlisted state, so one lookup is enough.
import { describe, expect, it } from 'vitest';

import {
  handinFieldSeeds,
  handinFieldsOnRecord,
  inheritanceFromFormData,
  resolveHandinInheritance,
} from '@/src/features/openmic/handin-record';

// A real Open Mic application: the state select and the city select, filled from
// the same table the hand-in form cascades from.
const ANAMBRA_APPLICATION = {
  'personal.firstName': 'Test',
  'personal.lastName': 'Artist',
  'personal.stageName': 'Test Artist',
  'personal.stateOfResidence': 'Anambra',
  'personal.city': 'Awka North',
  'social.instagram': '@testartist',
};

describe('Open Mic hand-in inheritance', () => {
  it('reads state and LGA from the registration keys the form writes', () => {
    expect(inheritanceFromFormData(ANAMBRA_APPLICATION)).toMatchObject({
      state: 'Anambra',
      lga: 'Awka North',
    });
  });

  it('accepts the `personal.lga` spelling and ignores a city that is not an LGA', () => {
    expect(inheritanceFromFormData({ 'personal.stateOfResidence': 'Lagos', 'personal.lga': 'Ikeja' }))
      .toMatchObject({ state: 'Lagos', lga: 'Ikeja' });
    // A typed-in city from a contest whose list is free text must not become a
    // locked answer here; `handinFieldsOnRecord` is what refuses it.
    expect(inheritanceFromFormData({ 'personal.stateOfResidence': 'Lagos', 'personal.city': 'Yaba' }))
      .toMatchObject({ state: 'Lagos', lga: 'Yaba' });
  });

  it('is empty-safe: no row, no answers', () => {
    expect(inheritanceFromFormData(null)).toEqual({ email: '', state: '', lga: '', instagram: '', tiktok: '' });
    expect(inheritanceFromFormData({})).toEqual({ email: '', state: '', lga: '', instagram: '', tiktok: '' });
    expect(inheritanceFromFormData(undefined)).toEqual({ email: '', state: '', lga: '', instagram: '', tiktok: '' });
  });

  it('reads both handles and tolerates the older key spelling', () => {
    expect(inheritanceFromFormData({ 'social.instagram': '@ada', 'social.tiktok': '@ada_tk' }))
      .toMatchObject({ instagram: '@ada', tiktok: '@ada_tk' });
    expect(inheritanceFromFormData({ 'social.instagramHandle': '  @legacy  ' }))
      .toMatchObject({ instagram: '@legacy' });
    expect(inheritanceFromFormData({ 'social.tiktokHandle': '@legacy_tk' }))
      .toMatchObject({ tiktok: '@legacy_tk' });
  });

  it('takes the email from the application when it carries one', () => {
    expect(inheritanceFromFormData({ 'contact.email': '  a@b.c  ' })).toMatchObject({ email: 'a@b.c' });
    expect(inheritanceFromFormData({ 'personal.email': 'a@b.c' })).toMatchObject({ email: 'a@b.c' });
  });

  it('does not read a file value as an answer', () => {
    expect(inheritanceFromFormData({ 'personal.city': { url: 'https://x/y.mp3', fileName: 'y.mp3' } }))
      .toMatchObject({ lga: '' });
  });

  describe('handinFieldsOnRecord', () => {
    it('confirms a location pair that belongs together', () => {
      expect(handinFieldsOnRecord({ state: 'Anambra', lga: 'Awka North' })).toEqual({
        email: false,
        location: true,
        socials: false,
      });
    });

    it('confirms an email from the application or from the account', () => {
      expect(handinFieldsOnRecord({ email: 'a@b.c' }).email).toBe(true);
      expect(handinFieldsOnRecord({}).email).toBe(false);
      expect(handinFieldsOnRecord({}, '  a@b.c ').email).toBe(true);
      // The application wins over the account, but either is enough to ask nothing.
      expect(handinFieldsOnRecord({ email: 'a@b.c' }, 'other@c.d').email).toBe(true);
    });

    it('refuses a state the LGA list does not know', () => {
      expect(handinFieldsOnRecord({ state: 'Lagos State', lga: 'Ikeja' }).location).toBe(false);
      expect(handinFieldsOnRecord({ state: '', lga: 'Ikeja' }).location).toBe(false);
      expect(handinFieldsOnRecord({ state: 'Lagos', lga: '' }).location).toBe(false);
      expect(handinFieldsOnRecord({}).location).toBe(false);
    });

    it('refuses an LGA that belongs to a different state', () => {
      expect(handinFieldsOnRecord({ state: 'Abia', lga: 'Ikeja' }).location).toBe(false);
    });

    it('confirms Lagos with a Lagos LGA and Abia with an Abia LGA', () => {
      expect(handinFieldsOnRecord({ state: 'Lagos', lga: 'Ikeja' }).location).toBe(true);
      expect(handinFieldsOnRecord({ state: 'Abia', lga: 'Umuahia North' }).location).toBe(true);
      // The city the registration stored is this list's own wording: bare
      // 'Umuahia' is not one of Abia's sixteen LGAs, so it stays a question.
      expect(handinFieldsOnRecord({ state: 'Abia', lga: 'Umuahia' }).location).toBe(false);
    });

    it('confirms only handles the application actually answered', () => {
      // The registration asks for Instagram and TikTok and requires neither, while
      // the hand-in endpoint refuses a submission with no handle at all. So one
      // recorded handle answers the question and an empty entry must not: hiding
      // the fields on an entry that carries neither would block a recorded song.
      expect(handinFieldsOnRecord({ instagram: '@ada', tiktok: '@ada_tk' }).socials).toBe(true);
      expect(handinFieldsOnRecord({ instagram: '@ada', tiktok: '' }).socials).toBe(true);
      expect(handinFieldsOnRecord({ instagram: '', tiktok: 'ada_tk' }).socials).toBe(true);
      expect(handinFieldsOnRecord({ instagram: '   ', tiktok: '' }).socials).toBe(false);
      expect(handinFieldsOnRecord({ instagram: '', tiktok: '' }).socials).toBe(false);
      expect(handinFieldsOnRecord({}).socials).toBe(false);
      // A file value is not a handle. The real shape only ever arrives through the
      // form-data read, so the refusal is tested there and then re-asserted on the
      // answer it produces.
      const asFile = inheritanceFromFormData({ 'social.instagram': { url: 'https://x/y', fileName: 'y.mp3' } });
      expect(asFile.instagram).toBe('');
      expect(handinFieldsOnRecord(asFile).socials).toBe(false);
    });

    it('is undefined-safe', () => {
      expect(handinFieldsOnRecord(null)).toEqual({ email: false, location: false, socials: false });
      expect(handinFieldsOnRecord(undefined, undefined)).toEqual({ email: false, location: false, socials: false });
    });
  });

  describe('handinFieldSeeds', () => {
    // The invariant this exists for: the value a confirmed row displays is the
    // value the form body carries. Mobile shipped a bug where the row advertised an
    // answer the state never received (#1134), so the pairing is tested here rather
    // than trusted to two ternaries in a component.
    it('seeds exactly what the rows will claim', () => {
      expect(handinFieldSeeds({
        state: 'Anambra', lga: 'Awka North', instagram: '@adaforce', tiktok: '@ada_tk',
      })).toEqual({
        state: 'Anambra', lga: 'Awka North', instagramHandle: '@adaforce', tiktokHandle: '@ada_tk',
      });
    });

    it('seeds a handle the entry answered with only one of the two', () => {
      expect(handinFieldSeeds({ instagram: '  @adaforce  ', tiktok: '' })).toEqual({
        state: '', lga: '', instagramHandle: '@adaforce', tiktokHandle: '',
      });
    });

    it('refuses to seed an answer it would not confirm', () => {
      // An LGA outside the state’s list stays a question, and an entry that
      // answered neither handle leaves both fields empty rather than seeding a
      // blank the artist then cannot be told to fill.
      expect(handinFieldSeeds({ state: 'Abia', lga: 'Ikeja', instagram: '', tiktok: '   ' })).toEqual({
        state: '', lga: '', instagramHandle: '', tiktokHandle: '',
      });
    });

    it('is undefined-safe', () => {
      expect(handinFieldSeeds(null)).toEqual({ state: '', lga: '', instagramHandle: '', tiktokHandle: '' });
      expect(handinFieldSeeds(undefined)).toEqual({ state: '', lga: '', instagramHandle: '', tiktokHandle: '' });
    });
  });

  describe('resolveHandinInheritance', () => {
    const applications = [
      {
        contestSlug: 'spotlight-open-mic-2026-10',
        updatedAt: '2026-10-05T00:00:00.000Z',
        formData: { 'personal.stateOfResidence': 'Lagos', 'personal.city': 'Agege' },
      },
      {
        // The catalog slug an approval made before the editions got their own slug
        // still carries, and it is the newer record.
        contestSlug: 'open-mic-competition',
        updatedAt: '2026-11-18T00:00:00.000Z',
        formData: ANAMBRA_APPLICATION,
      },
      {
        contestSlug: 'reality-tv-show',
        updatedAt: '2026-11-19T00:00:00.000Z',
        formData: { 'personal.stateOfResidence': 'Edo', 'personal.city': 'Egor' },
      },
    ];

    it('prefers this edition’s own application', () => {
      expect(resolveHandinInheritance(applications, 'spotlight-open-mic-2026-10'))
        .toMatchObject({ state: 'Lagos', lga: 'Agege', source: 'exact' });
    });

    it('falls back to the newest Open Mic application, never another contest’s', () => {
      expect(resolveHandinInheritance(applications, 'spotlight-open-mic-2026-11'))
        .toMatchObject({ state: 'Anambra', lga: 'Awka North', source: 'open-mic' });
      expect(resolveHandinInheritance([{ contestSlug: 'reality-tv-show', updatedAt: '2026-11-19T00:00:00.000Z', formData: {} }], 'open-mic'))
        .toMatchObject({ state: '', source: 'none' });
    });

    it('carries the chosen application’s handles, and no other contest’s', () => {
      // ANAMBRA_APPLICATION records an Instagram handle, so the edition picked for
      // this artist brings it along; a row from another contest is not a source,
      // handles included, which is what keeps the pair a question there.
      expect(resolveHandinInheritance(applications, 'spotlight-open-mic-2026-11'))
        .toMatchObject({ instagram: '@testartist', tiktok: '' });
      expect(resolveHandinInheritance(
        [{ contestSlug: 'reality-tv-show', updatedAt: '2026-11-19T00:00:00.000Z', formData: { 'social.instagram': '@other' } }],
        'open-mic',
      )).toMatchObject({ instagram: '', source: 'none' });
    });

    it('reports no answers at all when the account has no Open Mic application', () => {
      // The account email is deliberately NOT folded in here: it is not something
      // the application said, and the screen has to be able to tell the artist
      // which of the two places a confirmed value came from.
      expect(resolveHandinInheritance([], 'open-mic')).toMatchObject({
        email: '', state: '', lga: '', source: 'none',
      });
      expect(handinFieldsOnRecord(resolveHandinInheritance([], 'open-mic'), ' me@x.y ').email).toBe(true);
    });

    it('ignores rows with no slug and survives a malformed list', () => {
      expect(() => resolveHandinInheritance([{}, null as never], 'open-mic')).not.toThrow();
      expect(resolveHandinInheritance([null, undefined], 'open-mic')).toMatchObject({ state: '' });
    });
  });
});
