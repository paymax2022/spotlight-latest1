// ── Admin — Paymax Connect OPS control-plane service ─────────────────────────
// OPS half of the Connect console: RBAC, gamification ops, catalog/comms,
// analytics, geo, support and (read-only) config. Separate file from
// connectAdminService.ts so the trust/money admin agent owns that one.
//
// Mock by default (mirrors connectAdminService). Flip with
// NEXT_PUBLIC_CONNECT_USE_MOCK=false to hit the live Go backend at
// /api/connect/admin/*. All money is integer minor units (kobo); XP/coins are
// NON-CASH gamification points — admin tooling must never convert them to money.

import { env } from '@/config/env';

const USE_MOCK = (process.env.NEXT_PUBLIC_CONNECT_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/connect/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();

// ─── Types ───────────────────────────────────────────────────────────────────
export interface ConnectRole {
  id: string;
  name: string;
  slug: string;
  description: string;
  is_system: boolean;
  admin_count: number;
}
export interface ConnectPermission {
  slug: string;        // e.g. connect.cases.read
  group: string;       // e.g. cases
  description: string;
  roles: string[];     // role slugs that hold it
}
export interface ConnectAdminUser {
  id: string;
  name: string;
  email: string;
  roles: string[];     // role slugs
  mfa_enabled: boolean;
  last_active_at: string;
  status: 'active' | 'suspended';
}
export interface ConnectRbac {
  roles: ConnectRole[];
  permissions: ConnectPermission[];
  admins: ConnectAdminUser[];
}

export type MissionStatus = 'active' | 'scheduled' | 'ended' | 'draft';
export interface ConnectMission {
  id: string;
  title: string;
  description: string;
  goal: string;          // e.g. "Complete 3 verified matches"
  reward_xp: number;     // NON-CASH
  reward_coins: number;  // NON-CASH
  status: MissionStatus;
  starts_at: string;
  ends_at: string | null;
  completions: number;
}
export interface ConnectSeason {
  id: string;
  name: string;
  theme: string;
  status: MissionStatus;
  starts_at: string;
  ends_at: string;
  mission_count: number;
  participants: number;
}
export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  display_name: string;
  score: number;     // XP — NON-CASH
  region: string;
}
export interface ConnectLeaderboards {
  season_id: string;
  season_name: string;
  updated_at: string;
  entries: LeaderboardEntry[];
}

export interface ConnectGift {
  id: string;
  name: string;
  emoji: string;
  price_kobo: number;     // money — integer minor units
  animation: string;
  category: string;
  active: boolean;
}
export type CommType = 'announcement' | 'push' | 'banner';
export interface ConnectComm {
  id: string;
  title: string;
  type: CommType;
  audience: string;       // e.g. "All verified · Lagos"
  status: 'sent' | 'scheduled' | 'draft';
  body: string;
  scheduled_at: string | null;
  sent_at: string | null;
}

export interface AnalyticsTile {
  key: string;
  label: string;
  value: string;
  delta: string;          // e.g. "+4.2%"
  trend: 'up' | 'down' | 'flat';
  group: 'engagement' | 'retention' | 'funnel' | 'revenue';
}
export interface ConnectAnalytics {
  generated_at: string;
  tiles: AnalyticsTile[];
  funnel: Array<{ step: string; count: number }>;
}

export interface GeoMarket {
  id: string;
  name: string;
  country: string;
  status: 'live' | 'pilot' | 'restricted' | 'blocked';
  users: number;
  approximate_only: boolean;
  notes: string;
}
export interface GeoConfig {
  approximate_location_policy: string;
  trust_threshold: string;
  source: string;         // backend-owned
  markets: GeoMarket[];
}

export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';
export interface SupportTicket {
  id: string;
  subject: string;
  user_id: string;
  user_name: string;
  category: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: TicketStatus;
  created_at: string;
  updated_at: string;
}
export interface SupportMessage {
  id: string;
  author: string;
  role: 'user' | 'agent';
  body: string;
  created_at: string;
}
export interface SupportTicketDetail extends SupportTicket {
  messages: SupportMessage[];
  linked_case_id: string | null;
}

export interface ConfigFlag {
  key: string;
  value: string;
  scope: 'global' | 'region' | 'cohort';
  source: string;         // backend-owned
}
export interface MatchingWeight {
  key: string;
  weight: number;
  description: string;
}
export interface ConfigLimit {
  key: string;
  value: string;
  description: string;
}
export interface ConnectConfig {
  source: string;         // backend-owned — read-only in admin
  updated_at: string;
  flags: ConfigFlag[];
  matching_weights: MatchingWeight[];
  limits: ConfigLimit[];
}

// ─── Mock datasets ────────────────────────────────────────────────────────────
const ROLES: ConnectRole[] = [
  { id: 'role_super', name: 'Super Admin', slug: 'connect.role.super_admin', description: 'Full Connect control plane', is_system: true, admin_count: 2 },
  { id: 'role_safety', name: 'Safety Lead', slug: 'connect.role.safety_lead', description: 'Cases, moderation, audit', is_system: true, admin_count: 4 },
  { id: 'role_mod', name: 'Moderator', slug: 'connect.role.moderator', description: 'Triage queues, no config', is_system: false, admin_count: 9 },
  { id: 'role_growth', name: 'Growth Ops', slug: 'connect.role.growth_ops', description: 'Gamification, comms, analytics', is_system: false, admin_count: 3 },
  { id: 'role_support', name: 'Support Agent', slug: 'connect.role.support_agent', description: 'Tickets and CRM only', is_system: false, admin_count: 12 },
];

const PERMISSIONS: ConnectPermission[] = [
  { slug: 'connect.cases.read', group: 'cases', description: 'View safety cases', roles: ['connect.role.super_admin', 'connect.role.safety_lead', 'connect.role.moderator'] },
  { slug: 'connect.cases.update', group: 'cases', description: 'Triage / resolve cases', roles: ['connect.role.super_admin', 'connect.role.safety_lead'] },
  { slug: 'connect.audit.read', group: 'audit', description: 'Read immutable audit log', roles: ['connect.role.super_admin', 'connect.role.safety_lead'] },
  { slug: 'connect.rbac.manage', group: 'rbac', description: 'Manage roles & admins', roles: ['connect.role.super_admin'] },
  { slug: 'connect.gamification.manage', group: 'gamification', description: 'Missions / seasons (non-cash)', roles: ['connect.role.super_admin', 'connect.role.growth_ops'] },
  { slug: 'connect.catalog.manage', group: 'catalog', description: 'Gift catalog & pricing', roles: ['connect.role.super_admin', 'connect.role.growth_ops'] },
  { slug: 'connect.comms.send', group: 'comms', description: 'Send announcements / push', roles: ['connect.role.super_admin', 'connect.role.growth_ops'] },
  { slug: 'connect.analytics.read', group: 'analytics', description: 'View analytics dashboards', roles: ['connect.role.super_admin', 'connect.role.growth_ops', 'connect.role.safety_lead'] },
  { slug: 'connect.geo.manage', group: 'geo', description: 'Market & geo policy', roles: ['connect.role.super_admin'] },
  { slug: 'connect.support.handle', group: 'support', description: 'Work support tickets', roles: ['connect.role.super_admin', 'connect.role.support_agent'] },
  { slug: 'connect.config.read', group: 'config', description: 'Read backend-owned config', roles: ['connect.role.super_admin', 'connect.role.safety_lead'] },
];

const ADMINS: ConnectAdminUser[] = [
  { id: 'adm_1', name: 'Amaka Obi', email: 'amaka@paymax.ng', roles: ['connect.role.super_admin'], mfa_enabled: true, last_active_at: iso(1), status: 'active' },
  { id: 'adm_2', name: 'Bola Ade', email: 'bola@paymax.ng', roles: ['connect.role.safety_lead'], mfa_enabled: true, last_active_at: iso(3), status: 'active' },
  { id: 'adm_3', name: 'Chidi Eze', email: 'chidi@paymax.ng', roles: ['connect.role.moderator', 'connect.role.support_agent'], mfa_enabled: false, last_active_at: iso(20), status: 'active' },
  { id: 'adm_4', name: 'Dami Lawal', email: 'dami@paymax.ng', roles: ['connect.role.growth_ops'], mfa_enabled: true, last_active_at: iso(48), status: 'suspended' },
];

const MISSIONS: ConnectMission[] = [
  { id: 'msn_1', title: 'Verified First Match', description: 'Reward intentional, verified connections', goal: 'Get 1 mutual match with a verified profile', reward_xp: 250, reward_coins: 50, status: 'active', starts_at: iso(72), ends_at: null, completions: 1840 },
  { id: 'msn_2', title: 'Weekend Networker', description: 'Drive professional-mode engagement', goal: 'Attend 1 networking event this weekend', reward_xp: 400, reward_coins: 80, status: 'scheduled', starts_at: iso(-48), ends_at: iso(-120), completions: 0 },
  { id: 'msn_3', title: 'Safe Chat Streak', description: 'Encourage on-platform, respectful chat', goal: 'Maintain a 5-day no-violation chat streak', reward_xp: 300, reward_coins: 60, status: 'active', starts_at: iso(168), ends_at: null, completions: 920 },
  { id: 'msn_4', title: 'Profile Polish', description: 'Onboarding completion nudge', goal: 'Complete all 5 profile mode fields', reward_xp: 150, reward_coins: 30, status: 'draft', starts_at: iso(0), ends_at: null, completions: 0 },
];

const SEASONS: ConnectSeason[] = [
  { id: 'sea_1', name: 'Harmattan Hearts', theme: 'Trust-first dating push', status: 'active', starts_at: iso(240), ends_at: iso(-480), mission_count: 6, participants: 12400 },
  { id: 'sea_2', name: 'New Year Networks', theme: 'Professional networking', status: 'scheduled', starts_at: iso(-720), ends_at: iso(-1440), mission_count: 4, participants: 0 },
  { id: 'sea_3', name: 'Detty December', theme: 'Events & creators', status: 'ended', starts_at: iso(2160), ends_at: iso(720), mission_count: 8, participants: 31200 },
];

const LEADERBOARDS: ConnectLeaderboards = {
  season_id: 'sea_1', season_name: 'Harmattan Hearts', updated_at: iso(1),
  entries: [
    { rank: 1, user_id: 'usr_9001', display_name: 'Ngozi A.', score: 9820, region: 'Lagos' },
    { rank: 2, user_id: 'usr_9002', display_name: 'Tunde B.', score: 9140, region: 'Abuja' },
    { rank: 3, user_id: 'usr_9003', display_name: 'Halima C.', score: 8760, region: 'Kano' },
    { rank: 4, user_id: 'usr_9004', display_name: 'Emeka D.', score: 8210, region: 'Port Harcourt' },
    { rank: 5, user_id: 'usr_9005', display_name: 'Funke E.', score: 7990, region: 'Ibadan' },
  ],
};

const GIFTS: ConnectGift[] = [
  { id: 'gift_rose', name: 'Rose', emoji: '🌹', price_kobo: 50_000, animation: 'bloom', category: 'romance', active: true },
  { id: 'gift_heart', name: 'Heart', emoji: '❤️', price_kobo: 20_000, animation: 'pulse', category: 'romance', active: true },
  { id: 'gift_crown', name: 'Crown', emoji: '👑', price_kobo: 500_000, animation: 'shine', category: 'premium', active: true },
  { id: 'gift_star', name: 'Rising Star', emoji: '⭐', price_kobo: 100_000, animation: 'spin', category: 'creator', active: true },
  { id: 'gift_jollof', name: 'Jollof Plate', emoji: '🍛', price_kobo: 35_000, animation: 'steam', category: 'fun', active: false },
];

const COMMS: ConnectComm[] = [
  { id: 'cm_1', title: 'Verify to unlock matching', type: 'announcement', audience: 'Unverified users', status: 'sent', body: 'Complete verification to start matching safely.', scheduled_at: null, sent_at: iso(6) },
  { id: 'cm_2', title: 'Harmattan Hearts is live', type: 'push', audience: 'All verified · Nigeria', status: 'scheduled', body: 'Join the season and climb the leaderboard.', scheduled_at: iso(-12), sent_at: null },
  { id: 'cm_3', title: 'Stay safe: never send money', type: 'banner', audience: 'All users', status: 'sent', body: 'Paymax Connect never asks you to send money to other users.', scheduled_at: null, sent_at: iso(72) },
  { id: 'cm_4', title: 'Networking weekend draft', type: 'push', audience: 'Professional mode', status: 'draft', body: '', scheduled_at: null, sent_at: null },
];

const ANALYTICS: ConnectAnalytics = {
  generated_at: iso(0),
  tiles: [
    { key: 'dau', label: 'DAU', value: '48,210', delta: '+4.2%', trend: 'up', group: 'engagement' },
    { key: 'mau', label: 'MAU', value: '512,900', delta: '+1.8%', trend: 'up', group: 'engagement' },
    { key: 'messages', label: 'Messages / day', value: '1.21M', delta: '+6.0%', trend: 'up', group: 'engagement' },
    { key: 'd1', label: 'D1 retention', value: '41%', delta: '-0.6%', trend: 'down', group: 'retention' },
    { key: 'd7', label: 'D7 retention', value: '23%', delta: '+0.9%', trend: 'up', group: 'retention' },
    { key: 'd30', label: 'D30 retention', value: '12%', delta: '+0.0%', trend: 'flat', group: 'retention' },
    { key: 'onboard', label: 'Onboarding completion', value: '67%', delta: '+2.1%', trend: 'up', group: 'funnel' },
    { key: 'verify', label: 'Verification rate', value: '54%', delta: '+3.4%', trend: 'up', group: 'funnel' },
    { key: 'first_match', label: 'First-match rate', value: '38%', delta: '+1.2%', trend: 'up', group: 'funnel' },
    { key: 'gmv', label: 'Gifting GMV', value: '₦18,420,000', delta: '+8.7%', trend: 'up', group: 'revenue' },
    { key: 'take', label: 'Take-rate revenue', value: '₦2,763,000', delta: '+8.7%', trend: 'up', group: 'revenue' },
    { key: 'arpu', label: 'ARPU', value: '₦359', delta: '+1.1%', trend: 'up', group: 'revenue' },
  ],
  funnel: [
    { step: 'Signup', count: 100_000 },
    { step: 'Age gate passed', count: 94_300 },
    { step: 'Onboarding complete', count: 63_200 },
    { step: 'Verified', count: 51_100 },
    { step: 'First match', count: 38_400 },
    { step: 'First gift sent', count: 11_900 },
  ],
};

const GEO_CONFIG: GeoConfig = {
  approximate_location_policy: 'Exact location is never exposed by default. Discovery uses coarse geohash (~5 km) until the trust threshold is met AND the user explicitly opts in.',
  trust_threshold: 'Verified + 3 mutual matches + 0 active safety cases',
  source: 'backend config: connect.geo.* (read-only here)',
  markets: [
    { id: 'mkt_ng', name: 'Nigeria', country: 'NG', status: 'live', users: 512_900, approximate_only: true, notes: 'Primary market' },
    { id: 'mkt_gh', name: 'Ghana', country: 'GH', status: 'pilot', users: 18_400, approximate_only: true, notes: 'Accra pilot' },
    { id: 'mkt_ke', name: 'Kenya', country: 'KE', status: 'pilot', users: 9_200, approximate_only: true, notes: 'Nairobi pilot' },
    { id: 'mkt_za', name: 'South Africa', country: 'ZA', status: 'restricted', users: 0, approximate_only: true, notes: 'Awaiting NDPA-equivalent review' },
  ],
};

const TICKETS: SupportTicketDetail[] = [
  {
    id: 'tkt_1', subject: 'Cannot complete verification', user_id: 'usr_5001', user_name: 'Sade Bello', category: 'verification',
    priority: 'high', status: 'open', created_at: iso(4), updated_at: iso(2), linked_case_id: null,
    messages: [
      { id: 'm1', author: 'Sade Bello', role: 'user', body: 'My NIN keeps failing during verification.', created_at: iso(4) },
      { id: 'm2', author: 'Support Bot', role: 'agent', body: 'Thanks — can you confirm the NIN was entered without spaces?', created_at: iso(3) },
    ],
  },
  {
    id: 'tkt_2', subject: 'Gift charged but not delivered', user_id: 'usr_5002', user_name: 'Kola Smith', category: 'payments',
    priority: 'critical', status: 'pending', created_at: iso(8), updated_at: iso(1), linked_case_id: null,
    messages: [
      { id: 'm1', author: 'Kola Smith', role: 'user', body: 'I sent a Crown gift (₦5,000) and it never showed.', created_at: iso(8) },
      { id: 'm2', author: 'Agent Dami', role: 'agent', body: 'Checking the ledger trace now, will update shortly.', created_at: iso(6) },
    ],
  },
  {
    id: 'tkt_3', subject: 'Report a suspicious profile', user_id: 'usr_5003', user_name: 'Ada Nwosu', category: 'safety',
    priority: 'high', status: 'open', created_at: iso(10), updated_at: iso(9), linked_case_id: 'case_2',
    messages: [
      { id: 'm1', author: 'Ada Nwosu', role: 'user', body: 'This account is asking me to send airtime urgently.', created_at: iso(10) },
    ],
  },
  {
    id: 'tkt_4', subject: 'How do I change my profile mode?', user_id: 'usr_5004', user_name: 'Ife Okon', category: 'general',
    priority: 'low', status: 'resolved', created_at: iso(30), updated_at: iso(26), linked_case_id: null,
    messages: [
      { id: 'm1', author: 'Ife Okon', role: 'user', body: 'Where is the switch between dating and networking?', created_at: iso(30) },
      { id: 'm2', author: 'Agent Bola', role: 'agent', body: 'Settings → Profile modes. Each mode has its own visibility.', created_at: iso(28) },
    ],
  },
];

const CONFIG: ConnectConfig = {
  source: 'Go backend — connect config service (/api/connect/admin/config). Read-only in admin; changes go through the backend config pipeline.',
  updated_at: iso(5),
  flags: [
    { key: 'connect.matching.enabled', value: 'true', scope: 'global', source: 'backend' },
    { key: 'connect.live.broadcasting', value: 'false', scope: 'global', source: 'backend' },
    { key: 'connect.gifting.enabled', value: 'true', scope: 'region', source: 'backend' },
    { key: 'connect.paid_voting', value: 'false', scope: 'global', source: 'backend' },
    { key: 'connect.season.harmattan_hearts', value: 'true', scope: 'cohort', source: 'backend' },
  ],
  matching_weights: [
    { key: 'shared_interests', weight: 0.30, description: 'Overlap in interest tags' },
    { key: 'proximity_coarse', weight: 0.20, description: 'Approximate geo distance (coarse)' },
    { key: 'verification_level', weight: 0.25, description: 'Higher trust = higher rank' },
    { key: 'activity_recency', weight: 0.15, description: 'Recent on-platform activity' },
    { key: 'intent_alignment', weight: 0.10, description: 'Matching profile-mode intent' },
  ],
  limits: [
    { key: 'daily_likes_free', value: '20', description: 'Free likes per day' },
    { key: 'daily_intro_requests', value: '5', description: 'Pre-match intro requests / day' },
    { key: 'max_active_matches', value: '50', description: 'Concurrent active matches' },
    { key: 'discovery_radius_km', value: '50', description: 'Default coarse discovery radius' },
  ],
};

// ─── API ──────────────────────────────────────────────────────────────────────
export async function getConnectRbac(): Promise<ConnectRbac> {
  if (USE_MOCK) { await delay(); return { roles: [...ROLES], permissions: [...PERMISSIONS], admins: [...ADMINS] }; }
  return getJson<ConnectRbac>('/rbac');
}
export async function listConnectRoles(): Promise<ConnectRole[]> {
  if (USE_MOCK) { await delay(); return [...ROLES]; }
  return getJson<ConnectRole[]>('/rbac/roles');
}
export async function listConnectPermissions(): Promise<ConnectPermission[]> {
  if (USE_MOCK) { await delay(); return [...PERMISSIONS]; }
  return getJson<ConnectPermission[]>('/rbac/permissions');
}

export async function listMissionsAdmin(status?: string): Promise<ConnectMission[]> {
  if (USE_MOCK) { await delay(); return status ? MISSIONS.filter((m) => m.status === status) : [...MISSIONS]; }
  return getJson<ConnectMission[]>(`/gamification/missions${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function listSeasonsAdmin(): Promise<ConnectSeason[]> {
  if (USE_MOCK) { await delay(); return [...SEASONS]; }
  return getJson<ConnectSeason[]>('/gamification/seasons');
}
export async function getLeaderboardsAdmin(): Promise<ConnectLeaderboards> {
  if (USE_MOCK) { await delay(); return { ...LEADERBOARDS, entries: [...LEADERBOARDS.entries] }; }
  return getJson<ConnectLeaderboards>('/gamification/leaderboards');
}

export async function listGiftCatalogAdmin(): Promise<ConnectGift[]> {
  if (USE_MOCK) { await delay(); return [...GIFTS]; }
  return getJson<ConnectGift[]>('/catalog/gifts');
}
export async function listComms(): Promise<ConnectComm[]> {
  if (USE_MOCK) { await delay(); return [...COMMS]; }
  return getJson<ConnectComm[]>('/comms');
}

export async function getConnectAnalytics(): Promise<ConnectAnalytics> {
  if (USE_MOCK) { await delay(); return { ...ANALYTICS, tiles: [...ANALYTICS.tiles], funnel: [...ANALYTICS.funnel] }; }
  return getJson<ConnectAnalytics>('/analytics');
}

export async function getGeoConfig(): Promise<GeoConfig> {
  if (USE_MOCK) { await delay(); return { ...GEO_CONFIG, markets: [...GEO_CONFIG.markets] }; }
  return getJson<GeoConfig>('/geo');
}

export async function listSupportTickets(status?: string): Promise<SupportTicket[]> {
  if (USE_MOCK) {
    await delay();
    const rows = TICKETS.map(({ messages: _m, linked_case_id: _c, ...t }) => t);
    return status ? rows.filter((t) => t.status === status) : rows;
  }
  return getJson<SupportTicket[]>(`/support/tickets${status ? `?status=${encodeURIComponent(status)}` : ''}`);
}
export async function getSupportTicket(id: string): Promise<SupportTicketDetail | null> {
  if (USE_MOCK) { await delay(); return TICKETS.find((t) => t.id === id) ?? null; }
  return getJson<SupportTicketDetail | null>(`/support/tickets/${encodeURIComponent(id)}`);
}

export async function getConnectConfig(): Promise<ConnectConfig> {
  if (USE_MOCK) { await delay(); return { ...CONFIG, flags: [...CONFIG.flags], matching_weights: [...CONFIG.matching_weights], limits: [...CONFIG.limits] }; }
  return getJson<ConnectConfig>('/config');
}

// Naira formatting helper (kobo → ₦) for money displays.
export function nairaFromKobo(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
