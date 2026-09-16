import { mockAllowed } from '@/config/mockPolicy';
import { Colors } from '@/constants/colors';
import type { MeetingMode, MeetingStatus, RsvpResponse } from '../types/meetings.types';

// Flip to false once the estate meetings endpoints are verified (or set
// EXPO_PUBLIC_MEETINGS_USE_MOCK=false). Mirrors the visitor/election convention.
export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_MEETINGS_USE_MOCK, true);

// Meetings are served by the resident-scoped frontend-web handlers under
// /api/v1/estate/meetings (GET list, POST create, GET /{mid}, POST /{mid}/rsvp,
// GET /{mid}/minutes). The current resident's estate is derived SERVER-SIDE from
// the auth token (frontend-web/src/server/meetings/meetings.service.ts →
// getResidentContext), so the client never passes an estate ID.
export const MEETINGS_API_BASE = '/api/v1/estate/meetings';

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
