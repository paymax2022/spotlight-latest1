// ── Connect onboarding — prefill "The basics" from the account ────────────────
// The user already gave their name, date of birth, gender and state when they
// set up their Paymax profile. Re-typing all four to enter Connect is friction
// for no gain, so this maps a stored profile onto the step's controls.
//
// ONE RULE governs everything here: a value is only offered when the control can
// actually DISPLAY it. Every field on this step is a picker over a fixed list
// (day/month/year, two genders, 37 states). Writing a value a picker has no
// option for renders as an empty control that nevertheless holds a value — the
// user sees a blank field, cannot tell anything is set, and submits an answer
// they never saw. A blank they must fill in is strictly better.
//
// Nothing here is authoritative: the screen keeps every field editable (a
// Connect display name is a chosen name, not a legal one), and the hard 18+ gate
// is decided server-side on submit regardless of what is prefilled.
//
// Pure — no React, no React Native — so it is unit-testable under plain node.

export interface PrefillSource {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  dateOfBirth?: string;
  gender?: string;
  state?: string;
}

export interface PrefillLists {
  days: string[];
  months: string[];
  years: string[];
  genders: string[];
  states: string[];
}

export interface BasicsPrefill {
  name: string;
  day: string;
  month: string;
  year: string;
  gender: string;
  location: string;
}

const EMPTY: BasicsPrefill = { name: '', day: '', month: '', year: '', gender: '', location: '' };

function clean(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Case-insensitive exact match against an option list. '' when absent. */
export function matchOption(value: string, options: string[]): string {
  const v = clean(value).toLowerCase();
  if (!v) return '';
  return options.find((o) => o.toLowerCase() === v) || '';
}

/**
 * A display name for the Connect profile.
 *
 * Sign-up stores the email as the display name when none was given, so that is
 * rejected — nobody's Connect profile should open pre-filled with their email
 * address. A single first name is preferred over "First Last" because this is
 * the name other users see ("e.g. Amara"), not a legal identity.
 */
export function prefillName(source: PrefillSource): string {
  const email = clean(source.email).toLowerCase();
  const first = clean(source.firstName);
  if (first) return first;

  const stored = clean(source.displayName);
  if (!stored || stored.toLowerCase() === email) return '';
  return stored.split(/\s+/)[0] || '';
}

/**
 * Split a stored yyyy-mm-dd into the three pickers.
 *
 * Returns blanks unless every part is selectable. The year list starts 18 years
 * back, so a stored DOB under 18 simply yields nothing to prefill — the age gate
 * is the server's call, and this only avoids seeding a year no picker can show.
 */
export function prefillDob(
  iso: string | undefined,
  lists: Pick<PrefillLists, 'days' | 'months' | 'years'>,
): { day: string; month: string; year: string } {
  const blank = { day: '', month: '', year: '' };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(iso));
  if (!m) return blank;

  const [, y, mm, dd] = m;
  const monthIndex = Number(mm) - 1;
  const monthName = lists.months[monthIndex];
  // Strip the leading zero: the day list is '1'…'31', not '01'.
  const day = String(Number(dd));

  if (!monthName) return blank;
  if (!lists.days.includes(day)) return blank;
  if (!lists.years.includes(y)) return blank;

  // Reject a date that is not a real calendar day (e.g. a stored 2000-02-31).
  const dt = new Date(Number(y), monthIndex, Number(dd));
  if (dt.getFullYear() !== Number(y) || dt.getMonth() !== monthIndex || dt.getDate() !== Number(dd)) {
    return blank;
  }

  return { day, month: monthName, year: y };
}

/**
 * The state picker spells the capital 'FCT - Abuja'; profiles store it half a
 * dozen ways. Only these well-known spellings are folded — anything else falls
 * through to a plain match and, failing that, to a blank the user fills in.
 */
const STATE_ALIASES: Record<string, string> = {
  fct: 'FCT - Abuja',
  abuja: 'FCT - Abuja',
  'fct abuja': 'FCT - Abuja',
  'fct-abuja': 'FCT - Abuja',
  'federal capital territory': 'FCT - Abuja',
};

export function prefillState(value: string | undefined, states: string[]): string {
  const raw = clean(value);
  if (!raw) return '';

  const direct = matchOption(raw, states);
  if (direct) return direct;

  // "Lagos State" → "Lagos"; profiles commonly carry the suffix.
  const withoutSuffix = raw.replace(/\s+state$/i, '');
  const trimmed = matchOption(withoutSuffix, states);
  if (trimmed) return trimmed;

  const alias = STATE_ALIASES[raw.toLowerCase()];
  return alias && states.includes(alias) ? alias : '';
}

/**
 * Everything the account can answer on this step.
 *
 * `draft` wins over `profile`: if the user has already been through this step,
 * what THEY chose must never be overwritten by what the account happens to hold.
 */
export function buildBasicsPrefill(
  profile: PrefillSource | null | undefined,
  draft: Partial<{ displayName: string; dob: string; gender: string; location: string }> | null | undefined,
  lists: PrefillLists,
): BasicsPrefill {
  if (!profile && !draft) return EMPTY;

  const draftDob = prefillDob(draft?.dob, lists);
  const profileDob = prefillDob(profile?.dateOfBirth, lists);
  // All three parts move together — mixing a draft year with a profile month
  // would compose a date neither source ever held.
  const dob = draftDob.year ? draftDob : profileDob;

  return {
    name: clean(draft?.displayName) || prefillName(profile ?? {}),
    day: dob.day,
    month: dob.month,
    year: dob.year,
    gender:
      matchOption(clean(draft?.gender), lists.genders) ||
      matchOption(clean(profile?.gender), lists.genders),
    location:
      prefillState(draft?.location, lists.states) ||
      prefillState(profile?.state, lists.states),
  };
}
