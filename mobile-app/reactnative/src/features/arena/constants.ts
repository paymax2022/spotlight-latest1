// ── Arena (Driver Contest) — constants, copy & lifecycle helpers ─────────────
// Single source of truth for the progress stepper, human labels, NDC-1 copy, and
// the 36 states + FCT selector. Keeps screens declarative.

import type { ContestantState, MeritStage } from './types';

// Dev/offline mode: when true (the default), the arena api returns mock data
// WITHOUT calling the backend — so the spectator screens are walkable and the
// console isn't spammed with 404s. Set EXPO_PUBLIC_ARENA_USE_MOCK=false once the
// Go /api/arena backend is live.
export const USE_MOCK = (process.env.EXPO_PUBLIC_ARENA_USE_MOCK ?? 'true') !== 'false';

/**
 * NDC-1 transparency note — surfaced anywhere Support money or Play-Along
 * engagement appears, so the user always understands it does NOT affect the crown.
 */
export const NDC1_SUPPORT_NOTE =
  'Support fuels the prize pot and the People’s Champion award. It does not affect judging or the crown.';

export const NDC1_MERIT_NOTE =
  'Your standing is decided only by Merit — screening, theory, practical and first-aid scores. Money and engagement never affect it.';

/** Small-cashback disclosure for the Play-Along reward (NL5-style). */
export const CASHBACK_DISCLOSURE =
  'Cashback is a small promotional reward credited to your wallet and ledgered. It is not a prize and does not affect any competition ranking.';

// ─── Progress stepper (Applied → Screened → Trained → Theory → Qualified → Finalist → Crowned) ──

export interface StepperNode {
  key: string;
  label: string;
  /** States that map onto this node as "current". */
  states: ContestantState[];
}

export const STEPPER: StepperNode[] = [
  { key: 'applied', label: 'Applied', states: ['APPLIED'] },
  { key: 'screened', label: 'Screened', states: ['SCREENED'] },
  { key: 'trained', label: 'Trained', states: ['TRAINED'] },
  { key: 'theory', label: 'Theory', states: ['THEORY_ASSIGNED', 'THEORY_TAKEN'] },
  { key: 'qualified', label: 'Qualified', states: ['QUALIFIED'] },
  { key: 'finalist', label: 'Finalist', states: ['FINALIST'] },
  { key: 'crowned', label: 'Crowned', states: ['CROWNED'] },
];

/** Ordered lifecycle used to compute how far the stepper has progressed. */
const STATE_ORDER: ContestantState[] = [
  'APPLIED',
  'SCREENED',
  'TRAINED',
  'THEORY_ASSIGNED',
  'THEORY_TAKEN',
  'QUALIFIED',
  'FINALIST',
  'CROWNED',
];

export const TERMINAL_STATES: ContestantState[] = [
  'CROWNED',
  'ELIMINATED',
  'REJECTED',
  'WITHDRAWN',
];

/** Index of the stepper node the given state currently sits on (0-based). */
export function stepperIndexForState(state: ContestantState): number {
  // Failure states collapse onto the furthest node the contestant reached; we
  // approximate to the theory node so the UI still reads sensibly.
  if (state === 'REJECTED') return 0;
  if (state === 'ELIMINATED') return 4;
  if (state === 'WITHDRAWN') return 0;
  const idx = STATE_ORDER.indexOf(state);
  if (idx < 0) return 0;
  // Map ordered state index onto the 7 stepper nodes.
  const node = STEPPER.findIndex((n) => n.states.includes(state));
  return node < 0 ? 0 : node;
}

// ─── Human labels ────────────────────────────────────────────────────────────

export const STATE_LABELS: Record<ContestantState, string> = {
  APPLIED: 'Application submitted',
  SCREENED: 'Screening passed',
  TRAINED: 'Training complete',
  THEORY_ASSIGNED: 'Exam batch assigned',
  THEORY_TAKEN: 'Exam submitted',
  QUALIFIED: 'Qualified',
  FINALIST: 'Finalist',
  CROWNED: 'Crowned Naija Driver',
  ELIMINATED: 'Eliminated',
  REJECTED: 'Not selected',
  WITHDRAWN: 'Withdrawn',
};

export const MERIT_STAGE_LABELS: Record<MeritStage, string> = {
  SCREENING: 'Screening',
  THEORY: 'Theory exam',
  PRACTICAL: 'Practical (finale)',
  FIRST_AID: 'First-aid (finale)',
};

// ─── Support presets (S5 / S8) — kobo ────────────────────────────────────────

export const SUPPORT_PRESETS_KOBO = [50_000, 100_000, 200_000, 500_000, 1_000_000];

/** Published split of a support contribution (must match backend attribution). */
export const SUPPORT_SPLIT = [
  { label: 'Prize pot', fraction: 0.7 },
  { label: "People’s Champion award", fraction: 0.3 },
];

// ─── 36 states + FCT ─────────────────────────────────────────────────────────

export const NIGERIA_STATES: string[] = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa',
  'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger',
  'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
  'FCT (Abuja)',
];

// ─── Play-Along quiz categories (S2) ─────────────────────────────────────────

export const PLAYALONG_CATEGORIES: { value: string; label: string }[] = [
  { value: 'road-signs', label: 'Road signs' },
  { value: 'highway-code', label: 'Highway code' },
  { value: 'safety', label: 'Road safety' },
];

// ─── Play-Along rounds (S2) ──────────────────────────────────────────────────
// The quiz is organised into three categorised rounds, each opening with a short
// lesson video. In production the round's video (title / url / poster) is served
// from the competition config and is ADMIN-EDITABLE (A1 config console); the URLs
// below are mock placeholders so the flow is walkable in dev — swap them for the
// real safety-curriculum clips.
export interface PlayAlongVideo {
  title: string;
  url: string;         // playable source (mp4 / stream) — opened by the player
  posterUrl: string;   // thumbnail shown before play
  durationLabel: string;
}
export interface PlayAlongRound {
  round: 1 | 2 | 3;
  category: string;    // maps to a PLAYALONG_CATEGORIES value
  label: string;       // "Round 1"
  title: string;       // category title
  blurb: string;
  video: PlayAlongVideo;
}

export const PLAYALONG_ROUNDS: PlayAlongRound[] = [
  {
    round: 1, category: 'road-signs', label: 'Round 1', title: 'Road signs',
    blurb: 'Warm up: recognise the signs that keep you safe on Nigerian roads.',
    video: {
      title: 'Round 1 briefing — Road signs',
      url: 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      posterUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg',
      durationLabel: '2:30',
    },
  },
  {
    round: 2, category: 'highway-code', label: 'Round 2', title: 'Highway code',
    blurb: 'Step it up: right-of-way, overtaking, and the rules of the road.',
    video: {
      title: 'Round 2 briefing — Highway code',
      url: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
      posterUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/ElephantsDream.jpg',
      durationLabel: '3:10',
    },
  },
  {
    round: 3, category: 'safety', label: 'Round 3', title: 'Road safety',
    blurb: 'Final round: hazard awareness and crash-site first-aid basics.',
    video: {
      title: 'Round 3 briefing — Road safety & first aid',
      url: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
      posterUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerJoyrides.jpg',
      durationLabel: '1:45',
    },
  },
];

/** Amount formatting (kobo → ₦). */
export function formatNaira(kobo: number): string {
  const naira = Math.round(kobo) / 100;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: naira % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "last updated" stamp for offline-tolerant reads. */
export function lastUpdatedLabel(iso?: string | null): string {
  if (!iso) return 'Last updated just now';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Last updated recently';
  return `Last updated ${d.toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}
