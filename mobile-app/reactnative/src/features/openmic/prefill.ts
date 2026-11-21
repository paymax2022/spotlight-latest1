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
 * already signed up with an email and already picked their state and LGA while
 * applying sees three required inputs and has to work out whether they are
 * being asked again. This answers the earlier question — is there anything here
 * to ask at all? — and the card renders a confirmed value when the answer is yes.
 *
 * The `location` pair is only inherited when it is a value THIS form could have
 * produced: the state must be one the LGA cascade knows, and the LGA must be in
 * that state's own list. A record holding 'Lagos State' or an LGA that belongs to
 * another state would otherwise lock the artist out of an answer they are allowed
 * to correct — the registration's city question and the hand-in's LGA question
 * share a list but not a label, so a stale or foreign spelling is possible.
 * Anything that cannot be shown as confirmed stays an ordinary, answerable field.
 * (The `knownStateName` read restates what `lgasForState` already does by failing
 * closed for an unlisted state; mutation-proving it on 2026-11-21 found no test
 * that separates the two, so it stays as documentation of the rule, not as a gate.)
 */
export interface HandinOnRecord {
  email: boolean;
  location: boolean;
}

export function handinFieldsOnRecord(
  prefill: Partial<SongFormPrefill> | null | undefined,
  accountEmail?: string,
): HandinOnRecord {
  const email = text(prefill?.email) || text(accountEmail);

  const state = text(prefill?.state);
  const lga = text(prefill?.lga);
  const location = !!state && !!lga && !!knownStateName(state) && lgasForState(state).includes(lga);

  return { email: !!email, location };
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
