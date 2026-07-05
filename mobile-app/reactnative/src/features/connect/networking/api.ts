// Paymax Connect — Networking API (PRD §10.3 NW-*).
// Mock-first (USE_MOCK). Live path hits `${CONNECT_API_BASE}/networking/...`.
// SAFETY §5: sending a request-to-connect NEVER opens a thread; the recipient
// must accept first. Money is ALWAYS kobo.

import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../constants/connect.constants';
import type {
  NetworkProfile,
  NetworkFilters,
  ConnectRequestResult,
  Endorsement,
  EndorsableSkill,
  Community,
  CommunityPost,
  CreateCommunityInput,
  NetworkEvent,
  CreateEventInput,
  RsvpState,
} from './types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

const PHOTO = (seed: string) => `https://images.unsplash.com/${seed}?auto=format&fit=crop&w=800&q=60`;

// ── Mock professionals ───────────────────────────────────────────────────────
const MOCK_PROFILES: NetworkProfile[] = [
  {
    id: 'n1',
    displayName: 'Ifeoma Okoro',
    headline: 'Staff Engineer · Lagos',
    occupation: 'Staff Software Engineer',
    company: 'Paystack',
    bio: 'Payments infra. I mentor junior engineers and angel-invest in African fintech.',
    photos: [PHOTO('photo-1573496359142-b8d87734a5a2')],
    skills: ['Go', 'Distributed Systems', 'Payments', 'Mentoring'],
    interests: ['Fintech', 'Open source', 'Running'],
    distanceLabel: '~4 km away',
    verified: ['selfie', 'identity'],
    mutualConnections: 6,
    openTo: ['Mentoring', 'Advising'],
    endorsements: 28,
    connectionState: 'none',
  },
  {
    id: 'n2',
    displayName: 'David Mensah',
    headline: 'Founder & CEO · Accra',
    occupation: 'Founder',
    company: 'AgriPay',
    bio: 'Building agri-fintech rails for West Africa. Hiring across product & growth.',
    photos: [PHOTO('photo-1519085360753-af0119f7cbe7')],
    skills: ['Fundraising', 'Strategy', 'Growth', 'Product'],
    interests: ['Agriculture', 'Impact', 'Tennis'],
    distanceLabel: '~11 km away',
    verified: ['selfie', 'identity', 'photo'],
    mutualConnections: 3,
    openTo: ['Hiring', 'Co-founders', 'Investors'],
    endorsements: 41,
    connectionState: 'incoming',
  },
  {
    id: 'n3',
    displayName: 'Aisha Bello',
    headline: 'Product Lead · Abuja',
    occupation: 'Senior Product Manager',
    company: 'Flutterwave',
    bio: '0→1 product builder. Love talking discovery, research and African UX.',
    photos: [PHOTO('photo-1494790108377-be9c29b29330')],
    skills: ['Product Strategy', 'Research', 'Roadmapping'],
    interests: ['Design', 'Travel', 'Photography'],
    distanceLabel: '~7 km away',
    verified: ['selfie', 'identity'],
    mutualConnections: 9,
    openTo: ['Mentoring', 'Speaking'],
    endorsements: 33,
    connectionState: 'connected',
  },
  {
    id: 'n4',
    displayName: 'Chidi Eze',
    headline: 'Data Scientist · Lagos',
    occupation: 'Data Scientist',
    company: 'Kuda',
    bio: 'ML for credit & fraud. Open to side projects and study groups.',
    photos: [PHOTO('photo-1500648767791-00dcc994a43e')],
    skills: ['Python', 'ML', 'Risk', 'SQL'],
    interests: ['AI', 'Chess', 'Coffee'],
    distanceLabel: '~2 km away',
    verified: ['selfie'],
    mutualConnections: 1,
    openTo: ['Collaborating', 'Study groups'],
    endorsements: 12,
    connectionState: 'requested',
  },
];

const OPEN_TO_OPTIONS = ['Mentoring', 'Hiring', 'Co-founders', 'Investors', 'Advising', 'Collaborating', 'Speaking'];
const SKILL_OPTIONS = ['Go', 'Python', 'Product', 'Design', 'Growth', 'ML', 'Payments', 'Fundraising'];

export const NETWORK_OPEN_TO_OPTIONS = OPEN_TO_OPTIONS;
export const NETWORK_SKILL_OPTIONS = SKILL_OPTIONS;

// ── Feed (NW-01) ─────────────────────────────────────────────────────────────
export async function getNetworkFeed(filters: NetworkFilters): Promise<NetworkProfile[]> {
  if (USE_MOCK) {
    await delay();
    const q = filters.query.trim().toLowerCase();
    return MOCK_PROFILES.filter((p) => {
      if (filters.verifiedOnly && p.verified.length === 0) return false;
      if (filters.skills.length && !filters.skills.some((s) => p.skills.includes(s))) return false;
      if (filters.openTo.length && !filters.openTo.some((o) => p.openTo.includes(o))) return false;
      if (q && !(`${p.displayName} ${p.headline} ${p.company ?? ''}`.toLowerCase().includes(q))) return false;
      return true;
    }).map((p) => ({ ...p }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/feed`, { params: filters });
  return unwrap<NetworkProfile[]>(res);
}

export async function getNetworkProfile(id: string): Promise<NetworkProfile> {
  if (USE_MOCK) {
    await delay(180);
    return { ...(MOCK_PROFILES.find((p) => p.id === id) ?? MOCK_PROFILES[0]) };
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/profiles/${id}`);
  return unwrap<NetworkProfile>(res);
}

// ── Request-to-connect (NW-04) — SAFETY §5: no thread until accepted ─────────
export async function sendConnectRequest(profileId: string, note: string): Promise<ConnectRequestResult> {
  if (USE_MOCK) {
    await delay(360);
    return { ok: true, requestId: `req_${profileId}_${Date.now()}`, state: 'requested' };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/requests`, { profileId, note });
  return unwrap<ConnectRequestResult>(res);
}

// ── Endorsements (NW-11) ─────────────────────────────────────────────────────
export async function getEndorsements(profileId: string): Promise<{ skills: EndorsableSkill[]; recent: Endorsement[] }> {
  if (USE_MOCK) {
    await delay();
    const profile = MOCK_PROFILES.find((p) => p.id === profileId) ?? MOCK_PROFILES[0];
    const skills: EndorsableSkill[] = profile.skills.map((skill, i) => ({
      skill,
      count: 3 + ((i * 5) % 11),
      endorsedByViewer: i === 0,
    }));
    const recent: Endorsement[] = [
      { id: 'e1', skill: profile.skills[0], endorserName: 'Tobi A.', endorsedAt: new Date(Date.now() - 86400000).toISOString() },
      { id: 'e2', skill: profile.skills[1] ?? profile.skills[0], endorserName: 'Amaka N.', endorsedAt: new Date(Date.now() - 3 * 86400000).toISOString() },
    ];
    return { skills, recent };
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/profiles/${profileId}/endorsements`);
  return unwrap<{ skills: EndorsableSkill[]; recent: Endorsement[] }>(res);
}

export async function endorseSkill(profileId: string, skill: string): Promise<{ ok: true; skill: string; count: number }> {
  if (USE_MOCK) {
    await delay(220);
    return { ok: true, skill, count: 1 };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/profiles/${profileId}/endorsements`, { skill });
  return unwrap<{ ok: true; skill: string; count: number }>(res);
}

// ── Communities (NW-05..NW-07) ───────────────────────────────────────────────
const MOCK_COMMUNITIES: Community[] = [
  { id: 'c1', name: 'Lagos Fintech Builders', description: 'Engineers, PMs and founders shipping African payments.', coverUrl: PHOTO('photo-1521737604893-d14cc237f11d'), category: 'Fintech', memberCount: 2480, isPrivate: false, joined: true },
  { id: 'c2', name: 'Women in Product NG', description: 'A supportive space for women building product across Nigeria.', coverUrl: PHOTO('photo-1573164713988-8665fc963095'), category: 'Product', memberCount: 1310, isPrivate: true, joined: false },
  { id: 'c3', name: 'AI Study Circle', description: 'Weekly papers, projects and ML interview prep.', coverUrl: PHOTO('photo-1620712943543-bcc4688e7485'), category: 'AI', memberCount: 870, isPrivate: false, joined: false },
];

const MOCK_POSTS: CommunityPost[] = [
  { id: 'cp1', authorName: 'Ifeoma Okoro', body: 'Hosting a free Go workshop next Saturday — drop your questions below.', createdAt: new Date(Date.now() - 3600000).toISOString(), likes: 42, comments: 11 },
  { id: 'cp2', authorName: 'David Mensah', body: 'We are hiring 2 backend engineers. DM me if you want a referral.', createdAt: new Date(Date.now() - 5 * 3600000).toISOString(), likes: 88, comments: 23 },
];

export async function getCommunities(query?: string): Promise<Community[]> {
  if (USE_MOCK) {
    await delay();
    const q = (query ?? '').trim().toLowerCase();
    return MOCK_COMMUNITIES.filter((c) => !q || c.name.toLowerCase().includes(q)).map((c) => ({ ...c }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/communities`, { params: { q: query } });
  return unwrap<Community[]>(res);
}

export async function getCommunity(id: string): Promise<{ community: Community; posts: CommunityPost[] }> {
  if (USE_MOCK) {
    await delay(180);
    const community = MOCK_COMMUNITIES.find((c) => c.id === id) ?? MOCK_COMMUNITIES[0];
    return { community: { ...community }, posts: MOCK_POSTS.map((p) => ({ ...p })) };
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/communities/${id}`);
  return unwrap<{ community: Community; posts: CommunityPost[] }>(res);
}

export async function toggleJoinCommunity(id: string, join: boolean): Promise<{ ok: true; joined: boolean }> {
  if (USE_MOCK) {
    await delay(200);
    return { ok: true, joined: join };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/communities/${id}/${join ? 'join' : 'leave'}`);
  return unwrap<{ ok: true; joined: boolean }>(res);
}

export async function createCommunity(input: CreateCommunityInput): Promise<Community> {
  if (USE_MOCK) {
    await delay(500);
    return { id: `c_${Date.now()}`, ...input, memberCount: 1, joined: true };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/communities`, input);
  return unwrap<Community>(res);
}

// ── Events (NW-08..NW-10) ────────────────────────────────────────────────────
const MOCK_EVENTS: NetworkEvent[] = [
  { id: 'ev1', title: 'Fintech Founders Mixer', description: 'Casual evening of intros, drinks and demos for fintech builders.', coverUrl: PHOTO('photo-1511795409834-ef04bbd61622'), startsAt: new Date(Date.now() + 3 * 86400000).toISOString(), venue: 'The Zone, Gbagada', city: 'Lagos', isOnline: false, hostName: 'Lagos Fintech Builders', attendeeCount: 142, capacity: 200, priceKobo: 0, rsvp: 'going', tags: ['Fintech', 'Networking'] },
  { id: 'ev2', title: 'Product Discovery Masterclass', description: 'Hands-on session on running effective product discovery.', coverUrl: PHOTO('photo-1540575467063-178a50c2df87'), startsAt: new Date(Date.now() + 7 * 86400000).toISOString(), venue: 'Online (Zoom)', city: 'Online', isOnline: true, hostName: 'Women in Product NG', attendeeCount: 310, priceKobo: 500000, rsvp: 'interested', tags: ['Product', 'Workshop'] },
  { id: 'ev3', title: 'AI Demo Night', description: 'Five-minute lightning demos from the AI study circle.', startsAt: new Date(Date.now() + 12 * 86400000).toISOString(), venue: 'Civic Centre', city: 'Lagos', isOnline: false, hostName: 'AI Study Circle', attendeeCount: 64, capacity: 120, priceKobo: 0, rsvp: 'none', tags: ['AI', 'Demos'] },
];

export async function getEvents(query?: string): Promise<NetworkEvent[]> {
  if (USE_MOCK) {
    await delay();
    const q = (query ?? '').trim().toLowerCase();
    return MOCK_EVENTS.filter((e) => !q || e.title.toLowerCase().includes(q)).map((e) => ({ ...e }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/events`, { params: { q: query } });
  return unwrap<NetworkEvent[]>(res);
}

export async function getEvent(id: string): Promise<NetworkEvent> {
  if (USE_MOCK) {
    await delay(180);
    return { ...(MOCK_EVENTS.find((e) => e.id === id) ?? MOCK_EVENTS[0]) };
  }
  const res = await api.get(`${CONNECT_API_BASE}/networking/events/${id}`);
  return unwrap<NetworkEvent>(res);
}

export async function rsvpEvent(id: string, state: RsvpState): Promise<{ ok: true; rsvp: RsvpState }> {
  if (USE_MOCK) {
    await delay(220);
    return { ok: true, rsvp: state };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/events/${id}/rsvp`, { state });
  return unwrap<{ ok: true; rsvp: RsvpState }>(res);
}

export async function createEvent(input: CreateEventInput): Promise<NetworkEvent> {
  if (USE_MOCK) {
    await delay(500);
    return {
      id: `ev_${Date.now()}`,
      ...input,
      hostName: 'You',
      attendeeCount: 1,
      rsvp: 'going',
      tags: [],
    };
  }
  const res = await api.post(`${CONNECT_API_BASE}/networking/events`, input);
  return unwrap<NetworkEvent>(res);
}
