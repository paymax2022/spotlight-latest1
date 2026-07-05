import { Colors } from '@/constants/colors';
import type { MeetingMode, MeetingStatus, RsvpResponse } from '../types/meetings.types';

// Flip to false once the estate meetings endpoints are verified (or set
// EXPO_PUBLIC_MEETINGS_USE_MOCK=false). Mirrors the visitor/election convention.
export const USE_MOCK = (process.env.EXPO_PUBLIC_MEETINGS_USE_MOCK ?? 'true') !== 'false';

// Meetings are NOT a standalone backend module — they are nested under the
// Estate module on the Go backend (Gin), confirmed against
// backend/internal/app/finance_routes.go (estGroup := finance.Group("/estate"))
// + backend/internal/estate/handler.go (CreateMeeting/ListMeetings/GetMeeting/
// RSVPMeeting/GetMinutes all take :id (estate) + :mid). There is NO flat
// /meetings namespace and no frontend-web proxy for /api/v1/estate/meetings —
// the blanket rewrite only covers /api/finance/:path*.
export const MEETINGS_API_BASE = '/api/finance/estate';

// The mobile meetings feature has no estate-selection UI yet (mirrors the
// election/facilities convention of a single hardcoded estate). Until
// multi-estate selection is wired, live calls target this one estate.
// MISSING: a shared estate-context provider so this isn't hardcoded per module.
export const DEFAULT_ESTATE_ID = 'est_amber_court';

// Module-scoped semantic colors (mirrors VotingColors/VisitorColors).
export const MeetingColors = {
  live:      '#16A34A',
  liveBg:    'rgba(22,163,74,0.12)',
  scheduled: Colors.secondary,
  scheduledBg: Colors.iconBgBlue,
  ended:     Colors.outline,
  endedBg:   'rgba(123,116,131,0.12)',
  cancelled: Colors.error,
  cancelledBg: Colors.errorContainer,
} as const;

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  scheduled: 'Upcoming',
  live: 'Live now',
  ended: 'Ended',
  cancelled: 'Cancelled',
};

export const MEETING_MODE_META: Record<MeetingMode, { label: string; icon: string }> = {
  physical: { label: 'In person', icon: 'MapPin' },
  virtual:  { label: 'Virtual', icon: 'Video' },
  hybrid:   { label: 'Hybrid', icon: 'Users' },
};

export const RSVP_META: Record<RsvpResponse, { label: string; color: string; bg: string }> = {
  yes:   { label: 'Going', color: MeetingColors.live, bg: MeetingColors.liveBg },
  maybe: { label: 'Maybe', color: '#B26B00', bg: 'rgba(245,158,11,0.12)' },
  no:    { label: "Can't go", color: Colors.error, bg: Colors.errorContainer },
};
