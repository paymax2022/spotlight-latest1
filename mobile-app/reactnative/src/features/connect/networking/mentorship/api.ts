// Paymax Connect — Mentorship API (Phase 6 §6.6 MN-01..03).
// Mock-first (USE_MOCK) — fully walkable offline. Live path hits
// `${CONNECT_API_BASE}/networking/mentorship…`.
//
// PN-7: the discovery payload is professional-only; no dating-mode signal is ever
// joined in. PN-9: opt-in is self-service, no approval gate.

import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../../constants/connect.constants';
import type {
  MentorshipOptInInput,
  MentorshipProfile,
  MentorProfile,
  MentorshipMatch,
  MatchResponse,
  MatchRespondResult,
} from './types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

const PHOTO = (seed: string) => `https://images.unsplash.com/${seed}?auto=format&fit=crop&w=400&q=60`;

// ── Mock mentors (MN-02) — professional fields ONLY (PN-7) ───────────────────
const MOCK_MENTORS: MentorProfile[] = [
  {
    id: 'm1',
    displayName: 'Ifeoma Okoro',
    headline: 'Staff Engineer · Lagos',
    occupation: 'Staff Software Engineer',
    company: 'Paystack',
    bio: 'Payments infra. I mentor junior engineers on systems design and career growth.',
    avatarUrl: PHOTO('photo-1573496359142-b8d87734a5a2'),
    domains: ['Engineering'],
    capacity: 3,
    availableSlots: 2,
    yearsExperience: 9,
    assessedSkills: [{ skill: 'Go (Backend)', assessmentVersion: 'v3' }],
    matchState: 'none',
  },
  {
    id: 'm2',
    displayName: 'Aisha Bello',
    headline: 'Product Lead · Abuja',
    occupation: 'Senior Product Manager',
    company: 'Flutterwave',
    bio: '0→1 product builder. Happy to help with discovery, prioritisation and PM interviews.',
    avatarUrl: PHOTO('photo-1494790108377-be9c29b29330'),
    domains: ['Product'],
    capacity: 2,
    availableSlots: 1,
    yearsExperience: 7,
    assessedSkills: [{ skill: 'Product Discovery', assessmentVersion: 'v2' }],
    matchState: 'none',
  },
  {
    id: 'm3',
    displayName: 'Chidi Eze',
    headline: 'Data Scientist · Lagos',
    occupation: 'Data Scientist',
    company: 'Kuda',
    bio: 'ML for credit & fraud. Mentoring on applied ML and moving from analyst to DS.',
    avatarUrl: PHOTO('photo-1500648767791-00dcc994a43e'),
    domains: ['Data', 'Engineering'],
    capacity: 4,
    availableSlots: 4,
    yearsExperience: 6,
    assessedSkills: [{ skill: 'Machine Learning', assessmentVersion: 'v4' }],
    matchState: 'none',
  },
  {
    id: 'm4',
    displayName: 'Tunde Bakare',
    headline: 'Design Director · Remote',
    occupation: 'Design Director',
    company: 'Independent',
    bio: 'Design systems and craft. I coach designers levelling up to senior/lead.',
    avatarUrl: PHOTO('photo-1519085360753-af0119f7cbe7'),
    domains: ['Design'],
    capacity: 2,
    availableSlots: 0,
    yearsExperience: 11,
    assessedSkills: [{ skill: 'UX Design', assessmentVersion: 'v1' }],
    matchState: 'none',
  },
];

// Session-mutable state so requests/responses persist within the app run.
const MATCH_STATE = new Map<string, MentorProfile['matchState']>();
let MY_PROFILE: MentorshipProfile | null = null;

export const MENTORSHIP_DOMAINS = ['Engineering', 'Product', 'Design', 'Data'];

// ── Opt-in (MN-01) ───────────────────────────────────────────────────────────
export async function optInMentorship(input: MentorshipOptInInput): Promise<MentorshipProfile> {
  if (USE_MOCK) {
    await delay(360);
    MY_PROFILE = {
      userId: 'me',
      role: input.role,
      domains: input.domains,
      capacity: input.capacity,
      activeMentees: 0,
      optedInAt: new Date().toISOString(),
    };
    return { ...MY_PROFILE };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/mentorship/opt-in`, input);
  return unwrap<MentorshipProfile>(res);
}

export async function getMyMentorshipProfile(): Promise<MentorshipProfile | null> {
  if (USE_MOCK) {
    await delay(120);
    return MY_PROFILE ? { ...MY_PROFILE } : null;
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/mentorship/me`);
  return unwrap<MentorshipProfile | null>(res);
}

// ── Discovery (MN-02) — safe mentor list, filter by domain ───────────────────
export async function getMentorDiscovery(domain?: string): Promise<MentorProfile[]> {
  if (USE_MOCK) {
    await delay();
    const d = (domain ?? '').trim();
    return MOCK_MENTORS
      .filter((m) => !d || m.domains.includes(d))
      .map((m) => ({ ...m, matchState: MATCH_STATE.get(m.id) ?? m.matchState }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/mentorship/discovery`, { params: { domain } });
  return unwrap<MentorProfile[]>(res);
}

export async function getMentor(id: string): Promise<MentorProfile> {
  if (USE_MOCK) {
    await delay(140);
    const m = MOCK_MENTORS.find((x) => x.id === id) ?? MOCK_MENTORS[0];
    return { ...m, matchState: MATCH_STATE.get(m.id) ?? m.matchState };
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/mentorship/mentors/${id}`);
  return unwrap<MentorProfile>(res);
}

// ── Match request (MN-03) — send ─────────────────────────────────────────────
export async function requestMentorshipMatch(mentorId: string, domain: string, message: string): Promise<MentorshipMatch> {
  if (USE_MOCK) {
    await delay(360);
    MATCH_STATE.set(mentorId, 'requested');
    const m = MOCK_MENTORS.find((x) => x.id === mentorId);
    return {
      id: `match_${mentorId}_${Date.now()}`,
      mentorId,
      mentorName: m?.displayName ?? 'Mentor',
      domain,
      message,
      state: 'requested',
      createdAt: new Date().toISOString(),
    };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/mentorship/matches`, { mentorId, domain, message });
  return unwrap<MentorshipMatch>(res);
}

// ── Match respond (MN-03) — accept / decline ─────────────────────────────────
export async function respondMentorshipMatch(matchId: string, action: MatchResponse, mentorId?: string): Promise<MatchRespondResult> {
  if (USE_MOCK) {
    await delay(300);
    const state = action === 'accept' ? 'accepted' : 'declined';
    if (mentorId) MATCH_STATE.set(mentorId, state);
    return { ok: true, matchId, state };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/mentorship/matches/${matchId}/respond`, { action });
  return unwrap<MatchRespondResult>(res);
}
