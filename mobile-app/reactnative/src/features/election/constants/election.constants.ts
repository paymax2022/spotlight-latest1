import { Colors } from '@/constants/colors';
import type { ElectionStatus } from '../types/election.types';

// Flip to false once the real /elections endpoints land (or set
// EXPO_PUBLIC_ELECTION_USE_MOCK=false). Mirrors the visitor/voting convention.
export const USE_MOCK = (process.env.EXPO_PUBLIC_ELECTION_USE_MOCK ?? 'true') !== 'false';

// Elections are served by the resident-scoped frontend-web handlers under
// /api/v1/elections (GET list, GET /active, GET /{id}, GET /{id}/ballot,
// GET /{id}/eligibility, POST create, POST /{id}/vote, POST /{id}/publish).
// The current resident's estate is derived SERVER-SIDE from the auth token
// (frontend-web/src/server/elections/elections.service.ts → getResidentContext),
// so the client never passes an estate ID.
export const ELECTION_API_BASE = '/api/v1/elections';

// Module-scoped semantic colors (mirrors the VotingColors/VisitorColors pattern).
export const ElectionColors = {
  live:    '#16A34A',
  liveBg:  'rgba(22,163,74,0.12)',
  scheduled:   Colors.secondary,
  scheduledBg: Colors.iconBgBlue,
  closed:   Colors.outline,
  closedBg: 'rgba(123,116,131,0.12)',
} as const;

export const ELECTION_STATUS_LABELS: Record<ElectionStatus, string> = {
  scheduled: 'Upcoming',
  live: 'Live now',
  closed: 'Closed',
  results_published: 'Results out',
};
