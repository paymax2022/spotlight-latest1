// ── Where the platform already knows a user's basics ─────────────────────────
// `user_profiles` is the canonical home for name / DOB / gender / state, but on
// this platform it is very often nearly empty: sign-up only captures a name and
// phone, and the columns that matter to Connect are filled in later, or never.
//
// The same details ARE captured elsewhere — a Film Academy application asks for
// gender, date of birth and state; a contest registration writes them into
// `registrations.form_data` under `personal.*`. Reading only `user_profiles`
// therefore leaves an onboarding form blank for a user the platform can already
// describe.
//
// So: take `user_profiles` as authoritative and fill only its GAPS from the
// other places the user has previously given the same answers. Never the
// reverse — a value the user has set on their profile always wins.
//
// This is read-only. Nothing here copies data between modules on disk; it only
// decides what to pre-fill a form with, and the user can change any of it.
//
// Pure — the Supabase reads live in ./fetchPrefillSources so these stay
// unit-testable under plain node.

import type { PrefillSource } from './profilePrefill';

/** Non-empty string, or undefined. Keeps "" out of the merge. */
function val(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Fills the gaps in `base` from `extra`, in order. A field already answered is
 * never overwritten, so the first source to supply a value wins.
 */
export function mergePrefillSources(
  base: PrefillSource | null | undefined,
  ...extra: Array<PrefillSource | null | undefined>
): PrefillSource {
  const out: PrefillSource = { ...(base ?? {}) };
  const keys: Array<keyof PrefillSource> = [
    'displayName', 'firstName', 'lastName', 'email', 'dateOfBirth', 'gender', 'state',
  ];
  for (const source of extra) {
    if (!source) continue;
    for (const k of keys) {
      if (!val(out[k]) && val(source[k])) out[k] = source[k];
    }
  }
  return out;
}

/** A Film Academy application — asks for gender, DOB and state directly. */
export function fromAcademyApplication(row: Record<string, unknown> | null | undefined): PrefillSource {
  if (!row) return {};
  return {
    displayName: val(row.full_name),
    dateOfBirth: val(row.date_of_birth),
    gender: val(row.gender),
    state: val(row.state),
  };
}

/** A contest registration draft — the engine stores answers under `personal.*`. */
export function fromRegistrationFormData(form: Record<string, unknown> | null | undefined): PrefillSource {
  if (!form) return {};
  return {
    firstName: val(form['personal.firstName']),
    lastName: val(form['personal.lastName']),
    dateOfBirth: val(form['personal.dateOfBirth']),
    gender: val(form['personal.gender']),
    state: val(form['personal.stateOfResidence']),
  };
}

/** Supabase auth metadata — what sign-up recorded, available without a query. */
export function fromAuthMetadata(meta: Record<string, unknown> | null | undefined, email?: string): PrefillSource {
  if (!meta) return {};
  return {
    displayName: val(meta.fullName) ?? val(meta.full_name) ?? val(meta.name),
    email: email ?? val(meta.email),
  };
}
