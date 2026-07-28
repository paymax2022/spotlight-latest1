// Paymax Connect — Mentorship types (Phase 6 §6.6, MN-01..03).
//
// SAFETY / INVARIANTS (Phase 6 §2):
//  PN-7  Mentorship discovery must NOT cross-leak Dating-mode profile signals.
//        MentorProfile therefore carries professional fields ONLY (no photos-of,
//        distanceLabel, "openTo dating", etc.). A mentee opting-in is a separate,
//        explicit capability — not derived from the dating profile.
//  PN-9  Mentor is a capability on the existing user, self-opt-in, no approval
//        gate (low risk) — see MentorshipRole.

export type MentorshipRole = 'mentor' | 'mentee' | 'both';

// MN-01 opt-in payload — role, domains and capacity (mentors only).
export interface MentorshipOptInInput {
  role: MentorshipRole;
  domains: string[];
  capacity: number;      // concurrent mentees a mentor will take (0 for mentee-only)
}

export interface MentorshipProfile {
  userId: string;
  role: MentorshipRole;
  domains: string[];
  capacity: number;
  activeMentees: number;
  optedInAt: string;     // ISO
}

// MN-02 discovery — a browsable mentor. Professional fields ONLY (PN-7).
export interface MentorProfile {
  id: string;
  displayName: string;
  headline: string;
  occupation: string;
  company?: string;
  bio?: string;
  avatarUrl?: string;
  domains: string[];
  capacity: number;
  availableSlots: number;             // capacity - activeMentees
  yearsExperience?: number;
  // Assessed skills only (source: 'assessed') — surfaced distinctly (PN-5).
  assessedSkills: { skill: string; assessmentVersion: string }[];
  // Viewer-relative match state so discovery can reflect an in-flight request.
  matchState: MentorshipMatchState;
}

export type MentorshipMatchState = 'none' | 'requested' | 'accepted' | 'declined';

// MN-03 — a match request between a mentee and a mentor.
export interface MentorshipMatch {
  id: string;
  mentorId: string;
  mentorName: string;
  domain?: string;
  message?: string;
  state: MentorshipMatchState;        // -> 'requested' on create
  createdAt: string;
}

export type MatchResponse = 'accept' | 'decline';

export interface MatchRespondResult {
  ok: boolean;
  matchId: string;
  state: MentorshipMatchState;        // -> 'accepted' | 'declined'
}
