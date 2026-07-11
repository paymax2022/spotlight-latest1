// Paymax Connect — Networking PROFILE API (PRD §6.3 PR-07..11, §6.5 RC-02/03).
// Mock-first (USE_MOCK). Live path hits `${CONNECT_API_BASE}/networking/...`.
//
// Contract (camelCase, {data:...}):
//   Experience:  GET/POST /networking/experience ; PUT/DELETE /networking/experience/:id
//   Education:   GET/POST /networking/education   ; PUT/DELETE /networking/education/:id
//   About:       GET /networking/about ; PUT /networking/about
//   Strength:    GET /networking/strength → { band, missing[] }   (PN-1: NO raw number)
//   Recs inbox:  GET /networking/recommendations/inbox            (subject's pending)
//                POST /networking/recommendations/:id/accept      (subject only)
//                POST /networking/recommendations/:id/decline     (subject only)
//   Public recs: GET /networking/users/:userId/recommendations    (accepted-only, PN-4)
//
// The mock derives Profile Strength from the SAME mutable profile state that the
// experience/education/about editors write to — so the strength meter updates as
// you fill sections in, fully walkable offline. The band is computed internally;
// only the band label + the missing checklist leave this module (PN-1).

import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../../constants/connect.constants';
import type {
  Experience,
  ExperienceInput,
  Education,
  EducationInput,
  About,
  AboutInput,
  ProfileStrength,
  StrengthBand,
  StrengthMissingItem,
  Recommendation,
} from './types';

const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// ── Mutable mock profile state ───────────────────────────────────────────────
const MOCK_EXPERIENCE: Experience[] = [
  {
    id: 'x1',
    title: 'Product Engineer',
    company: 'Paymax',
    employmentType: 'Full-time',
    location: 'Lagos, Nigeria',
    startDate: '2023-02',
    endDate: null,
    current: true,
    description: 'Building the Connect professional network and fintech super-app surfaces.',
  },
  {
    id: 'x2',
    title: 'Frontend Engineer',
    company: 'Flutterwave',
    employmentType: 'Full-time',
    location: 'Lagos, Nigeria',
    startDate: '2021-01',
    endDate: '2023-01',
    current: false,
    description: 'Owned the merchant dashboard redesign.',
  },
];

const MOCK_EDUCATION: Education[] = [
  {
    id: 'ed1',
    institution: 'University of Lagos',
    degree: 'BSc',
    fieldOfStudy: 'Computer Science',
    startYear: '2015',
    endYear: '2019',
    description: 'First Class Honours. Led the coding society.',
  },
];

let MOCK_ABOUT: About = {
  headline: 'Product Engineer · Lagos',
  summary:
    'Product-minded engineer focused on payments and professional networking. I care about shipping trustworthy, verified experiences.',
};

// ── Experience CRUD ──────────────────────────────────────────────────────────
export async function getExperience(): Promise<Experience[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_EXPERIENCE.map((e) => ({ ...e }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/experience`);
  return unwrap<Experience[]>(res);
}

export async function addExperience(input: ExperienceInput): Promise<Experience> {
  if (USE_MOCK) {
    await delay(360);
    const created: Experience = { id: `x_${Date.now()}`, ...input };
    MOCK_EXPERIENCE.unshift(created);
    return { ...created };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/experience`, input);
  return unwrap<Experience>(res);
}

export async function updateExperience(id: string, input: ExperienceInput): Promise<Experience> {
  if (USE_MOCK) {
    await delay(360);
    const idx = MOCK_EXPERIENCE.findIndex((e) => e.id === id);
    const updated: Experience = { id, ...input };
    if (idx >= 0) MOCK_EXPERIENCE[idx] = updated;
    return { ...updated };
  }
  const res = await api.put(`${CONNECT_API_BASE}/networking/experience/${id}`, input);
  return unwrap<Experience>(res);
}

export async function deleteExperience(id: string): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay(220);
    const idx = MOCK_EXPERIENCE.findIndex((e) => e.id === id);
    if (idx >= 0) MOCK_EXPERIENCE.splice(idx, 1);
    return { ok: true };
  }
  await api.delete(`${CONNECT_API_BASE}/networking/experience/${id}`);
  return { ok: true };
}

// ── Education CRUD ───────────────────────────────────────────────────────────
export async function getEducation(): Promise<Education[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_EDUCATION.map((e) => ({ ...e }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/education`);
  return unwrap<Education[]>(res);
}

export async function addEducation(input: EducationInput): Promise<Education> {
  if (USE_MOCK) {
    await delay(360);
    const created: Education = { id: `ed_${Date.now()}`, ...input };
    MOCK_EDUCATION.unshift(created);
    return { ...created };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/education`, input);
  return unwrap<Education>(res);
}

export async function updateEducation(id: string, input: EducationInput): Promise<Education> {
  if (USE_MOCK) {
    await delay(360);
    const idx = MOCK_EDUCATION.findIndex((e) => e.id === id);
    const updated: Education = { id, ...input };
    if (idx >= 0) MOCK_EDUCATION[idx] = updated;
    return { ...updated };
  }
  const res = await api.put(`${CONNECT_API_BASE}/networking/education/${id}`, input);
  return unwrap<Education>(res);
}

export async function deleteEducation(id: string): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay(220);
    const idx = MOCK_EDUCATION.findIndex((e) => e.id === id);
    if (idx >= 0) MOCK_EDUCATION.splice(idx, 1);
    return { ok: true };
  }
  await api.delete(`${CONNECT_API_BASE}/networking/education/${id}`);
  return { ok: true };
}

// ── About ────────────────────────────────────────────────────────────────────
export async function getAbout(): Promise<About> {
  if (USE_MOCK) {
    await delay(180);
    return { ...MOCK_ABOUT };
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/about`);
  return unwrap<About>(res);
}

export async function updateAbout(input: AboutInput): Promise<About> {
  if (USE_MOCK) {
    await delay(320);
    MOCK_ABOUT = { ...input };
    return { ...MOCK_ABOUT };
  }
  const res = await api.put(`${CONNECT_API_BASE}/networking/about`, input);
  return unwrap<About>(res);
}

// ── Profile Strength (PR-11) — PN-1: band + missing checklist ONLY ───────────
// The completion signal is computed internally and mapped to a qualitative band.
// The raw count/score never leaves this function.
function computeStrength(): ProfileStrength {
  const missing: StrengthMissingItem[] = [];
  if (!MOCK_ABOUT.summary || MOCK_ABOUT.summary.trim().length < 40) {
    missing.push({ key: 'about', label: 'Write a fuller About summary' });
  }
  if (MOCK_EXPERIENCE.length === 0) {
    missing.push({ key: 'experience', label: 'Add your work experience' });
  }
  if (MOCK_EDUCATION.length === 0) {
    missing.push({ key: 'education', label: 'Add your education' });
  }
  // Static profile checks a real backend would evaluate (kept in the checklist so
  // the meter always has room to grow without ever showing a number).
  missing.push({ key: 'skillAssessment', label: 'Pass a skill assessment to earn a verified badge' });
  missing.push({ key: 'recommendation', label: 'Get a recommendation accepted' });

  // Fewer missing items => higher band. Internal only (PN-1).
  const done = 5 - missing.length;
  let band: StrengthBand;
  if (done >= 5) band = 'all_star';
  else if (done >= 3) band = 'strong';
  else if (done >= 1) band = 'intermediate';
  else band = 'beginner';

  return { band, missing };
}

export async function getStrength(): Promise<ProfileStrength> {
  if (USE_MOCK) {
    await delay(200);
    return computeStrength();
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/strength`);
  return unwrap<ProfileStrength>(res);
}

// ── Recommendations (RC-02 inbox / accept·decline, RC-03 public) ─────────────
const MOCK_RECOMMENDATIONS: Recommendation[] = [
  {
    id: 'r1',
    authorUserId: 'n1',
    authorName: 'Ifeoma Okoro',
    authorHeadline: 'Staff Engineer · Paystack',
    subjectUserId: 'me',
    relationship: 'Managed you directly',
    body: 'One of the most reliable engineers I have worked with. Ships thoughtfully and mentors generously — I would hire them again in a heartbeat.',
    state: 'sent', // pending in the subject's inbox
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'r2',
    authorUserId: 'n3',
    authorName: 'Aisha Bello',
    authorHeadline: 'Product Lead · Flutterwave',
    subjectUserId: 'me',
    relationship: 'Worked together on the same team',
    body: 'A rare blend of product intuition and engineering rigour. Turned ambiguous discovery into shipped features repeatedly.',
    state: 'sent',
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: 'r3',
    authorUserId: 'n2',
    authorName: 'David Mensah',
    authorHeadline: 'Founder · AgriPay',
    subjectUserId: 'me',
    relationship: 'Client',
    body: 'Delivered ahead of schedule and communicated clearly throughout. Highly recommended.',
    state: 'acceptedVisible', // already accepted → shows on public profile
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
  },
];

// RC-02: the subject's PENDING recommendations (state 'sent') awaiting a decision.
export async function getRecommendationInbox(): Promise<Recommendation[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_RECOMMENDATIONS.filter((r) => r.state === 'sent').map((r) => ({ ...r }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/recommendations/inbox`);
  return unwrap<Recommendation[]>(res);
}

// PN-4: accept is a SUBJECT-only action — it is what makes a rec publicly visible.
export async function acceptRecommendation(id: string): Promise<Recommendation> {
  if (USE_MOCK) {
    await delay(280);
    const rec = MOCK_RECOMMENDATIONS.find((r) => r.id === id);
    if (rec) rec.state = 'acceptedVisible';
    return { ...(rec ?? MOCK_RECOMMENDATIONS[0]) };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/recommendations/${id}/accept`);
  return unwrap<Recommendation>(res);
}

// PN-4: decline hides it permanently — it is never publicly queryable.
export async function declineRecommendation(id: string): Promise<Recommendation> {
  if (USE_MOCK) {
    await delay(280);
    const rec = MOCK_RECOMMENDATIONS.find((r) => r.id === id);
    if (rec) rec.state = 'declinedHidden';
    return { ...(rec ?? MOCK_RECOMMENDATIONS[0]) };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/recommendations/${id}/decline`);
  return unwrap<Recommendation>(res);
}

// RC-03: public list — PN-4 accepted-only. Never returns sent/drafted/declined.
export async function getUserRecommendations(userId: string): Promise<Recommendation[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_RECOMMENDATIONS
      .filter((r) => r.subjectUserId === userId && r.state === 'acceptedVisible')
      .map((r) => ({ ...r }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/users/${userId}/recommendations`);
  return unwrap<Recommendation[]>(res);
}
