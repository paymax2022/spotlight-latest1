// Which applications are an Open Mic application — the phone's copy of the
// server's own rule.
//
// WHY THIS EXISTS
// The status screen decided "show the beat and the hand-in" from a slug list
// (`looksLikeOpenMicSlug`), and the local edition is registered as
// `open-mic-dev` — a slug no list contained. An approved Open Mic artist with a
// published beat therefore saw neither the beat nor the song upload, because a
// naming convention was asked to carry a fact the record already states.
//
// THE THREE SIGNALS (mirrors frontend-web/src/server/openmic/edition-identity.ts)
//   contest.type      === one_beat_one_verse   written by the Open Mic admin
//   contest.category  === open_mic             written by the registration plane
//   slug              in the catalogue list / monthly prefix
// The answers a draft stores are checked before the slug, and only those two
// keys: `talent.strengths` can legitimately contain the words "one beat one
// verse", and calling that an Open Mic edition would put a hand-in panel on a
// screen with no hand-in behind it.

import {
  OPEN_MIC_CONTEST_TYPE,
  OPEN_MIC_REGISTRATION_CATEGORY,
  looksLikeOpenMicSlug,
} from './constants';

export interface OpenMicApplicationInput {
  contestSlug?: string | null;
  formData?: Record<string, unknown> | null;
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** Is this application running in an Open Mic edition, however it came to be typed? */
export function isOpenMicApplication(input?: OpenMicApplicationInput | null): boolean {
  if (!input) return false;

  // Stored answers first: they describe the contest the applicant actually
  // chose, even when the edition was given a slug nobody predicted.
  const data = input.formData;
  if (data && typeof data === 'object') {
    if (normalized(data['contest.type']) === OPEN_MIC_CONTEST_TYPE) return true;
    if (normalized(data['contest.category']) === OPEN_MIC_REGISTRATION_CATEGORY) return true;
  }

  return looksLikeOpenMicSlug(input.contestSlug);
}
