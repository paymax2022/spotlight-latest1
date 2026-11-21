// Answers the artist already gave, reused by the song hand-in form.
//
// `POST /api/open-mic/submissions` needs `stageName`, `email`, `country`, `state`,
// `lga` and at least one social handle — and the Open Mic *registration* already
// asked for all of them. The hand-in screen is the last step an applicant takes
// before their song goes live, so re-asking is where entries get abandoned or
// mistyped (a mistyped stage name is also exactly what `createSubmission`'s dedupe
// compares). This module decides, in pure data, what is on record and therefore
// worth showing as an answer instead of a question.
//
// Like its mobile twin (`src/features/openmic/prefill.ts`), inheritance is never
// load-bearing: when the application read fails the row list is empty, this returns
// nothing, and the form asks every question as before. That is why the fetch lives
// in `src/server/openmic/handin-record.ts` behind a swallow-everything wrapper and
// everything here is mapping.
//
// Pure module — no `next/headers`, no Supabase — so vitest can cover it in node.
import { getOpenMicLgaOptions } from './location-options';

/** The three answers a hand-in form can inherit, as the application recorded them. */
export type HandinAnswers = Pick<HandinInheritance, 'email' | 'state' | 'lga'>;

/** The four Open Mic slug aliases plus a `spotlight-open-mic` prefix. */
const OPEN_MIC_SLUG_PREFIX = 'spotlight-open-mic';

/** Open Mic slugs a `registrations` row may carry — see constants.ts and the monthly editions. */
const OPEN_MIC_APPLICATION_SLUGS = ['open-mic-competition', 'open-mic', 'open-mic-2026'];

/** One of the artist's own applications, as the loader hands it over. */
export interface OpenMicApplicationLike {
  contestSlug?: string | null;
  updatedAt?: string | null;
  formData?: Record<string, unknown> | null;
}

/**
 * What the loader may hand over. The item type is deliberately nullable and the
 * list itself optional: an HTTP or database layer that yields `null` rows must
 * degrade to "no application", not throw on the way to a form the artist can
 * still fill in.
 */
export type OpenMicApplicationList =
  | Array<OpenMicApplicationLike | null | undefined>
  | null
  | undefined;

export interface HandinInheritance {
  /** The email written on the application. The account's own email is a separate input. */
  email: string;
  state: string;
  lga: string;
  /** Which application the answers came from, so a screen can say where they came from. */
  source: 'exact' | 'open-mic' | 'none';
}

export const EMPTY_INHERITANCE: HandinInheritance = {
  email: '', state: '', lga: '', source: 'none',
};

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    // A multi_select stored an array; the first answer is the best suggestion
    // and the artist can still change it.
    for (const item of value) {
      const out = text(item);
      if (out) return out;
    }
    return '';
  }
  // A file answer is `{ url, fileName }`, never a plain string, so nothing here
  // can be prefilled from an audition clip. Booleans and numbers are not answers
  // to any of these questions either.
  return '';
}

function slug(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function isOpenMicApplicationSlug(value: string): boolean {
  if (!value) return false;
  return OPEN_MIC_APPLICATION_SLUGS.includes(value) || value.startsWith(OPEN_MIC_SLUG_PREFIX);
}

/**
 * `registrations.form_data` keys, exactly as the Open Mic registration form writes
 * them (`src/features/registration/forms/open-mic-competition.ts`).
 *
 * The LGA has two spellings in the wild: this contest's "City / town" select is
 * stored as `personal.city` and is fed from the same LGA list, while the generic
 * field catalog also allows `personal.lga`. Either is worth a look — the pairing
 * rule in `handinFieldsOnRecord` is what decides whether it may be shown as
 * confirmed.
 */
export function inheritanceFromFormData(
  form: Record<string, unknown> | null | undefined,
): HandinAnswers {
  if (!form || typeof form !== 'object') return { email: '', state: '', lga: '' };
  return {
    email: text(form['contact.email']) || text(form['personal.email']),
    state: text(form['personal.stateOfResidence']),
    lga: text(form['personal.lga']) || text(form['personal.city']),
  };
}

/**
 * Pick the application that describes this artist for this edition and read the
 * answers it holds.
 *
 * Several rows can exist for one account, so the edition's own slug wins; with no
 * such row, the newest Open Mic application wins (a registration made before the
 * editions got their own slug carries the catalog slug, and `updated_at` is the
 * record a reviewer last touched). Another contest's application is never a
 * source — its state list and its city question are not this form's.
 *
 * Returns only what the APPLICATION said. The sign-up email is not in any
 * registration row, so callers pass it to `handinFieldsOnRecord` alongside this
 * and choose the wording that names where the value actually came from.
 */
export function resolveHandinInheritance(
  applications: OpenMicApplicationList,
  contestSlug: string,
): HandinInheritance {
  const target = slug(contestSlug);
  const rows = (applications ?? []).filter(
    (row): row is OpenMicApplicationLike => !!row && typeof row === 'object',
  );
  const candidates = rows.filter((row) => {
    const value = slug(row.contestSlug);
    if (!value) return false;
    return value === target || isOpenMicApplicationSlug(value);
  });
  const newest = (left: OpenMicApplicationLike, right: OpenMicApplicationLike) => (
    (Date.parse(String(right.updatedAt ?? '')) || 0) > (Date.parse(String(left.updatedAt ?? '')) || 0) ? right : left
  );
  const exact = candidates.filter((row) => slug(row.contestSlug) === target);
  const chosen = (exact.length ? exact : candidates).reduce<OpenMicApplicationLike | null>(
    (best, current) => (best === null || newest(best, current) === current ? current : best),
    null,
  );
  if (!chosen) return { ...EMPTY_INHERITANCE };
  return {
    ...inheritanceFromFormData(chosen.formData ?? null),
    source: exact.length ? 'exact' : 'open-mic',
  };
}

/**
 * Which hand-in facts are already on record, so the form can confirm them instead
 * of asking for them a second time.
 *
 * The location pair is only inherited when it is a value THIS form could have
 * produced: the state must have an LGA list, and the stored city must be inside
 * it. A record holding 'Lagos State', or a city typed for another state, would
 * otherwise lock the artist out of an answer they are allowed to correct — the
 * registration's city question and this form's LGA question share a list but not a
 * label. Anything that cannot be shown as confirmed stays an ordinary field.
 */
export interface HandinFieldsOnRecord {
  email: boolean;
  location: boolean;
}

export function handinFieldsOnRecord(
  inheritance: Partial<HandinAnswers> | null | undefined,
  accountEmail?: string,
): HandinFieldsOnRecord {
  const email = text(inheritance?.email) || text(accountEmail);
  const state = text(inheritance?.state);
  const lga = text(inheritance?.lga);
  return {
    email: !!email,
    location: !!state && !!lga && getOpenMicLgaOptions(state).includes(lga),
  };
}
