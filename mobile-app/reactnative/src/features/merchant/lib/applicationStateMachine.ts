// ── Merchant Onboarding — application state machine (PRD §7.2) ────────────────
// Pure transition guard shared by the client and mirrored by the server.

import type { ApplicationStatus } from '@/types/merchant';

export type ApplicationEvent = 'submit' | 'pick_up' | 'request_info' | 'resubmit' | 'approve' | 'reject';

const TRANSITIONS: Record<ApplicationStatus, Partial<Record<ApplicationEvent, ApplicationStatus>>> = {
  DRAFT:           { submit: 'SUBMITTED' },
  SUBMITTED:       { pick_up: 'UNDER_REVIEW' },
  UNDER_REVIEW:    { request_info: 'NEEDS_MORE_INFO', approve: 'APPROVED', reject: 'REJECTED' },
  NEEDS_MORE_INFO: { resubmit: 'UNDER_REVIEW' },
  APPROVED:        {},
  REJECTED:        {},
};

export function canTransition(from: ApplicationStatus, event: ApplicationEvent): boolean {
  return TRANSITIONS[from]?.[event] !== undefined;
}

/** Returns the next status, or throws on an illegal transition. */
export function applyEvent(from: ApplicationStatus, event: ApplicationEvent): ApplicationStatus {
  const next = TRANSITIONS[from]?.[event];
  if (!next) throw new Error(`Illegal transition: ${from} —${event}→ ?`);
  return next;
}

export const isTerminal = (s: ApplicationStatus): boolean => s === 'APPROVED' || s === 'REJECTED';
