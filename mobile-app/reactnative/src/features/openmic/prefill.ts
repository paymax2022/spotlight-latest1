// Answers the artist already gave, reused in the song hand-in form.
//
// The hand-in endpoint needs `stageName`, `email`, `country`, `state`, `lga` and
// at least one social handle — all of which the Open Mic *registration* already
// asked for. Re-typing them at the last step is where applications get abandoned
// or mistyped (and a mistyped stage name is what `createSubmission`'s dedupe
// compares), so the form opens prefilled and the artist confirms or corrects.
//
// Prefill is never load-bearing: if the application read fails, the form is blank
// and still submittable. That is why this module is pure mapping and the fetch
// that feeds it lives in `hooks.ts` with a swallow-everything wrapper. The same
// rule applies to `handinFieldsOnRecord` below, which decides whether a fact is
// worth showing as confirmed or asking as a field.
//
// Pure module — no `expo`, no `react-native` — so `node --test` can cover it.

import type { RegistrationDraft } from '../registration/types/registration.types';
import { OPEN_MIC_COUNTRY, knownStateName, lgasForState } from './location';

export interface SongFormPrefill {
  stageName: string;
  realName: string;
  email: string;
  country: string;
  state: string;
  /** The registration's city/town, offered as the LGA default, not forced. */
  lga: string;
  genre: string;
  instagramHandle: string;
  tiktokHandle: string;
}

export const EMPTY_PREFILL: SongFormPrefill = {
  stageName: '',
  realName: '',
  email: '',
  country: OPEN_MIC_COUNTRY,
  state: '',
  lga: '',
  genre: '',
  instagramHandle: '',
  tiktokHandle: '',
};

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    // A multi_select stored an array; the first answer is the best single
    // suggestion and the artist can change it.
    for (const item of value) {
      const out = text(item);
      if (out) return out;
    }
    return '';
  }
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return '';
  return '';
}

/**
 * `registrations.form_data` keys, exactly as the Open Mic registration form
 * writes them (`personal.stageName`, `category.genre`, `social.instagram`…).
 *
 * An uploaded file value is an object `{ url, fileName }`, never a plain string,
 * so a `text()` read of a file key returns '' — which is what we want here:
 * nothing in the hand-in form should be prefilled from an audition clip.
 */
export function prefillFromRegistrationFormData(
  form: Record<string, unknown> | null | undefined,
): Partial<SongFormPrefill> {
  if (!form || typeof form !== 'object') return {};
  const first = text(form['personal.firstName']);
  const last = text(form['personal.lastName']);
  const out: Partial<SongFormPrefill> = {};
  const stageName = text(form['personal.stageName']) || [first, last].filter(Boolean).join(' ');
  const realName = [first, last].filter(Boolean).join(' ');
  const email = text(form['contact.email']) || text(form['personal.email']);
  const state = text(form['personal.stateOfResidence']);
  const lga = text(form['personal.lga']) || text(form['personal.city']);
  const genre = text(form['category.genre']);
  const instagram = text(form['social.instagram']) || text(form['social.instagramHandle']);
  const tiktok = text(form['social.tiktok']) || text(form['social.tiktokHandle']);
  if (stageName) out.stageName = stageName;
  if (realName) out.realName = realName;
  if (email) out.email = email;
  if (state) out.state = state;
  if (lga) out.lga = lga;
  if (genre) out.genre = genre;
  if (instagram) out.instagramHandle = instagram;
  if (tiktok) out.tiktokHandle = tiktok;
  return out;
}

/** Merge a sparse prefill onto the defaults, so callers get a complete object. */
export function withPrefillDefaults(prefill: Partial<SongFormPrefill> | null | undefined): SongFormPrefill {
  return { ...EMPTY_PREFILL, ...prefill };
}

/**
 * Which hand-in facts are already on record, so the form can confirm them
 * instead of asking for them a second time.
 *
 * WHY THIS IS A RULE AND NOT A PREFILL DETAIL
 * Prefilling a field still leaves the question on the screen: an artist who
 * signed up with an email and picked their state, LGA and handles while applying
 * sees five more inputs and has to work out whether they are being asked again.
 * This answers the earlier question — is there anything here to ask at all? — and
 * the card renders the recorded answer as a confirmed value when it is.
 *
 * The `location` pair is only inherited when it is a value THIS form could have
 * produced: the state must be one the LGA cascade knows, and the LGA must be in
 * that state's own list. A record holding 'Lagos State' or an LGA that belongs to
 * another state would otherwise lock the artist out of an answer they are allowed
 * to correct — the registration's city question and the hand-in's LGA question
 * share a list but not a label, so a stale or foreign spelling is possible.
 * Anything that cannot be shown as recorded stays an ordinary, answerable field.
 * (The `knownStateName` read restates what `lgasForState` already does by failing
 * closed for an unlisted state; mutation-proving it on 2026-11-21 found no test
 * that separates the two, so it stays as documentation of the rule, not as a gate.)
 */
export interface HandinOnRecord {
  email: boolean;
  location: boolean;
  socials: boolean;
}

export function handinFieldsOnRecord(
  prefill: Partial<SongFormPrefill> | null | undefined,
  accountEmail?: string,
): HandinOnRecord {
  const email = text(prefill?.email) || text(accountEmail);

  const state = text(prefill?.state);
  const lga = text(prefill?.lga);
  const location = !!state && !!lga && !!knownStateName(state) && lgasForState(state).includes(lga);

  // The hand-in endpoint refuses a submission with no social handle, so the pair
  // can only be confirmed when the entry actually answered it. The registration
  // asks for both handles but requires neither, so an entry can legitimately reach
  // here empty — that case must stay a field, or the artist could not submit at all.
  // One handle is all the server asks for, so one handle is all this needs to call
  // it recorded.
  const socials = !!(text(prefill?.instagramHandle) || text(prefill?.tiktokHandle));

  return { email: !!email, location, socials };
}

/** The hand-in's own text boxes, keyed exactly as the card keys them. */
export interface HandinFieldValues {
  stageName: string;
  email: string;
  songTitle: string;
  state: string;
  lga: string;
  genre: string;
}

/**
 * Fill the boxes the entry can already answer, and only the ones still empty.
 *
 * WHY THIS IS A FUNCTION AND NOT THE CARD'S EFFECT
 * The effect inlined this as a `seed` helper that read `previous` for every key
 * instead of the value the line above had just produced, so each assignment
 * discarded the one before it and only the last survived — which, with a genre the
 * registration rarely stores, meant no answer at all reached the form. A named
 * rule with the accumulating object threaded through it is what the spec
 * (`seedHandinFields` in tests/unit/openmic) pins, and the card cannot repeat the
 * mistake because it has no loop of its own left to get wrong.
 *
 * Three rules the shape of this API encodes:
 *   • `songTitle` is deliberately not offerable. It is the new work, and an entry
 *     that did store a title for the audition question must not speak for it.
 *   • the LGA only follows the record while the state box still agrees with the
 *     record. The artist can change the state at any time (and doing so clears the
 *     LGA underneath it), and this effect re-runs whenever the prefill arrives, so
 *     seeding the pair blindly would paste the entry's Anambra LGA into a Lagos
 *     answer the artist just made.
 *   • the account fallback is withheld until the entry read settles. The session
 *     email is known on first paint and the approval arrives a beat later; because
 *     the rule above never overwrites a filled box, spending the account value in
 *     that window would lock the hand-in to the account email instead of the one
 *     the entry was approved under — which is what the server matches on, and what
 *     the confirmed row has to agree with to appear at all.
 */
export function seedHandinFields(
  current: HandinFieldValues,
  prefill: Partial<SongFormPrefill> | null | undefined,
  identity: { email?: string; displayName?: string },
  options?: { accountFallback?: boolean },
): HandinFieldValues {
  const fallback = options?.accountFallback !== false;
  const recordState = text(prefill?.state);
  const offered: Array<[keyof HandinFieldValues, string]> = [
    ['stageName', text(prefill?.stageName) || (fallback ? text(identity.displayName) : '')],
    ['email', text(prefill?.email) || (fallback ? text(identity.email) : '')],
    ['genre', text(prefill?.genre)],
    ['state', recordState],
    ['lga', text(prefill?.lga)],
  ];

  let next = current;
  for (const [key, value] of offered) {
    if (!value || next[key].trim()) continue;
    if (key === 'lga' && (next.state || '') !== recordState) continue;
    next = { ...next, [key]: value };
  }
  return next;
}

/** Everything the submit endpoint needs, as the screen currently holds it. */
export interface HandinFacts {
  stageName: string;
  email: string;
  state: string;
  lga: string;
  songTitle: string;
  instagram: string;
  tiktok: string;
  /** True when the artist picked a file, or the server already holds their bytes. */
  hasFile: boolean;
  beatDeclared: boolean;
  owned: boolean;
  samples: boolean;
}

/**
 * What still has to happen before this hand-in can be sent, in the order the
 * artist meets it on screen.
 *
 * The card used to compute its `disabled` flag from one expression and its
 * explain-what-is-missing sentence from a different one — and because the button
 * was hard-disabled, the sentence could never be reached: `onPress` does not fire
 * on a disabled control, so an artist with two unticked declarations saw an inert
 * button and no reason. Returning the list is what lets both halves read from the
 * same source: the CTA is enabled exactly when this is empty, and the same words
 * are printed above it while it is not.
 */
export function handinOutstanding(facts: HandinFacts): string[] {
  const out: string[] = [];
  if (!text(facts.stageName)) out.push('stage name');
  if (!text(facts.email)) out.push('email');
  if (!text(facts.state)) out.push('state');
  if (!text(facts.lga)) out.push('LGA');
  if (!text(facts.songTitle)) out.push('song title');
  // One handle is all `createSubmission` asks for; the registration asks for both
  // and requires neither, so an entry can arrive with a single one filled.
  if (!text(facts.instagram) && !text(facts.tiktok)) out.push('at least one social handle');
  if (!facts.hasFile) out.push('the finished MP3');
  if (!facts.beatDeclared) out.push('the beat declaration');
  if (!facts.owned) out.push('the ownership declaration');
  if (!facts.samples) out.push('the sample declaration');
  return out;
}

/**
 * The application that describes this artist for Open Mic.
 *
 * Several drafts can exist for one account, so the match is by slug with the
 * Open Mic aliases allowed (a registration made before the editions got their own
 * slug carries the catalog slug `open-mic-competition`), and the most recently
 * updated one wins because that is the record the reviewer last touched.
 */
export function pickOpenMicApplication(
  drafts: RegistrationDraft[] | null | undefined,
  contestSlug: string,
  isOpenMicSlug: (slug: string) => boolean,
): RegistrationDraft | null {
  const candidates = (drafts ?? []).filter((draft) => {
    const slug = String(draft?.contestSlug ?? '').trim();
    if (!slug) return false;
    return slug === contestSlug || isOpenMicSlug(slug);
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, current) => {
    const bestTime = Date.parse(String(best.updatedAt ?? '')) || 0;
    const currentTime = Date.parse(String(current.updatedAt ?? '')) || 0;
    return currentTime > bestTime ? current : best;
  });
}

/**
 * The account's own identity, for the two fields the registration cannot supply:
 * the bearer of the session is the applicant, and their sign-up email is the one
 * `createSubmission` will match against.
 */
export function identityFromUser(
  user: { id?: string; email?: string; user_metadata?: Record<string, unknown> | null } | null | undefined,
): { userId: string; email: string; displayName: string } {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const displayName =
    text(meta.fullName) || text(meta.full_name) || text(meta.name) || text(meta.display_name);
  return {
    userId: text(user?.id),
    email: text(user?.email),
    displayName,
  };
}
