import { Colors } from '@/constants/colors';
import type { ElectionStatus } from '../types/election.types';

// Flip to false once the real /elections endpoints land (or set
// EXPO_PUBLIC_ELECTION_USE_MOCK=false). Mirrors the visitor/voting convention.
export const USE_MOCK = (process.env.EXPO_PUBLIC_ELECTION_USE_MOCK ?? 'true') !== 'false';

// Elections are NOT a standalone backend module — they are nested under the
// Estate module on the Go backend (Gin), confirmed against
// backend/internal/app/finance_routes.go (estGroup := finance.Group("/estate"))
// + backend/internal/estate/handler.go (CreateElection/CastVote/GetResults/
// GetVoterEligibility/SetEligibilityRules all take :id (estate) + :electionId).
// There is NO flat /elections namespace and no frontend-web proxy for it.
export const ELECTION_API_BASE = '/api/finance/estate';

// The mobile election feature has no estate-selection UI yet (mirrors the
// mock's single hardcoded "est_amber_court" estate). Until multi-estate
// selection is wired, live calls target this one estate.
// MISSING: an estate-context provider so this isn't hardcoded.
export const DEFAULT_ESTATE_ID = 'est_amber_court';

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
