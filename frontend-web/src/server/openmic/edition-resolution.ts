/**
 * "Which Open Mic edition does this slug refer to?"
 *
 * Two planes write two different slugs for the same programme. The registration
 * catalog calls Open Mic `open-mic-competition` and that is what lands in
 * `registrations.contest_slug`; the edition an admin publishes has its own slug
 * (`open-mic-dev`, `open-mic-christmas-edition`). `registrations` has no
 * `contest_id`, so the slug is the only link between an application and an edition
 * — and when no `contests` row carries the catalog slug, an exact lookup finds
 * nothing at all.
 *
 * That is not a hypothetical: it is what an approved artist hit. The workflow
 * reader answered `isOpenMic: false`, so the status screen rendered no Open Mic
 * panel, and `/api/open-mic/me/eligibility` answered 404 `Contest not found`, so
 * the phone's phase panel had neither a beat to download nor an upload to offer.
 * The application was approved; the screens simply could not find the edition.
 *
 * The rule here is the only place that answers the question, and both planes call
 * it: an exact slug match wins outright, and the live edition is a fallback for an
 * application that IS Open Mic and whose slug names no row. The fallback is gated
 * on identity precisely so a talent search or a film audition can never be handed
 * an Open Mic edition — and with it a beat and an upload slot — by accident.
 */
import { getActiveOpenMicEdition } from '@/src/features/openmic/active-edition';
import type { OpenMicContest } from '@/src/features/openmic/types';
import { getContestBySlug } from '@/src/server/openmic/persistence';
import { isOpenMicRegistration, type RegistrationIdentityHint } from './edition-identity';

/**
 * The edition a slug refers to, or null.
 *
 * `hint` is what the caller knows about the application beyond its slug — for a
 * registration draft, `form_data['contest.type']` and `form_data['contest.category']`,
 * which the registration plane locked on at creation. Omit it when all you have is
 * a slug (a query parameter, a deep link): a catalog slug is then enough on its
 * own, because it is one of the identities `isOpenMicRegistration` recognises.
 */
export async function resolveOpenMicEdition(
  slug: string | null | undefined,
  hint?: RegistrationIdentityHint | null,
): Promise<OpenMicContest | null> {
  const wanted = String(slug ?? '').trim();

  if (wanted) {
    // `getContestBySlug` already refuses rows that are not Open Mic, so a hit here
    // is the artist's own edition and nothing else is consulted.
    const exact = await getContestBySlug(wanted);
    if (exact) return exact;
  }

  // The slug the caller passed counts as an identity signal too: a client that
  // only knows the catalog slug has already told us which programme this is.
  const identity: RegistrationIdentityHint = { ...hint, slug: hint?.slug || wanted };
  if (!isOpenMicRegistration(identity)) return null;

  // One live edition, or nothing. `getActiveOpenMicEdition` never falls back to
  // "the newest row whatever it is", so an ended or draft edition is never handed
  // to an applicant as the one to upload against.
  return getActiveOpenMicEdition();
}
