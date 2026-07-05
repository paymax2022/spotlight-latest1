// Paymax Connect — LIVE STREAMING api (mock-first via USE_MOCK).
// Live path hits `${CONNECT_API_BASE}/live/...` on the Go backend; Phase 0 is mock.
// Money is ALWAYS kobo. Every gift send carries an Idempotency-Key (real money).

import { api } from '@/api/client';
import { USE_MOCK, CONNECT_API_BASE } from '../constants/connect.constants';
import type {
  LiveStream,
  LiveCategory,
  LiveChatMessage,
  LiveGift,
  GiftSendResult,
  PkBattle,
  LiveLeaderboardEntry,
  StreamReplay,
  CoHostRequest,
  StreamReportReason,
  StreamReportResult,
  BroadcastPreflight,
  BroadcastSession,
  LiveViewer,
  StreamSummary,
} from './types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));
function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// Idempotency-Key for money mutations (money-handling iron rule). Stable per
// attempt so a retry of the same gift does not double-charge.
export function makeIdempotencyKey(scope: string): string {
  return `connect-${scope}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const AV = (s: string) => `https://i.pravatar.cc/160?u=${s}`;
const COVER = (s: string) => `https://picsum.photos/seed/${s}/600/800`;

// ── Discovery (LV-01..LV-03) ─────────────────────────────────────────────────
const MOCK_STREAMS: LiveStream[] = [
  {
    id: 'ls_1', title: 'Friday Afrobeats live set 🎧', hostName: 'DJ Kemi', hostId: 'h1',
    hostAvatar: AV('kemi'), coverUrl: COVER('kemi'), category: 'music', format: 'single',
    viewerCount: 1284, locationLabel: 'Lagos', distanceKm: 3.2, isFollowing: true,
    moderationState: 'approved', startedAtIso: new Date(Date.now() - 18 * 60_000).toISOString(),
  },
  {
    id: 'ls_2', title: 'PK Battle: who sings better?', hostName: 'Tomi vs Bola', hostId: 'h2',
    hostAvatar: AV('tomi'), coverUrl: COVER('tomi'), category: 'music', format: 'pk',
    viewerCount: 3411, locationLabel: 'Abuja', distanceKm: 12, isFollowing: false,
    moderationState: 'approved', startedAtIso: new Date(Date.now() - 6 * 60_000).toISOString(),
  },
  {
    id: 'ls_3', title: 'Startup Q&A — ask me anything', hostName: 'Chuka', hostId: 'h3',
    hostAvatar: AV('chuka'), coverUrl: COVER('chuka'), category: 'talk', format: 'multi',
    viewerCount: 642, locationLabel: 'Lagos', distanceKm: 5.4, isFollowing: false,
    moderationState: 'approved', startedAtIso: new Date(Date.now() - 32 * 60_000).toISOString(),
  },
  {
    id: 'ls_4', title: 'Late night talk room 🌙', hostName: 'Ada', hostId: 'h4',
    hostAvatar: AV('ada'), coverUrl: COVER('ada'), category: 'lifestyle', format: 'audio',
    viewerCount: 209, locationLabel: 'Ibadan', distanceKm: 120, isFollowing: true,
    moderationState: 'approved', startedAtIso: new Date(Date.now() - 50 * 60_000).toISOString(),
  },
  {
    id: 'ls_5', title: 'FIFA grind — road to legend', hostName: 'Zee', hostId: 'h5',
    hostAvatar: AV('zee'), coverUrl: COVER('zee'), category: 'gaming', format: 'single',
    viewerCount: 877, locationLabel: 'Port Harcourt', distanceKm: 40, isFollowing: false,
    moderationState: 'approved', startedAtIso: new Date(Date.now() - 12 * 60_000).toISOString(),
  },
  {
    id: 'ls_6', title: 'Dance challenge finals 💃', hostName: 'Naomi', hostId: 'h6',
    hostAvatar: AV('naomi'), coverUrl: COVER('naomi'), category: 'dance', format: 'single',
    viewerCount: 1502, locationLabel: 'Lagos', distanceKm: 2.1, isFollowing: false,
    moderationState: 'approved', startedAtIso: new Date(Date.now() - 4 * 60_000).toISOString(),
  },
];

export async function listLiveStreams(category: LiveCategory = 'all'): Promise<LiveStream[]> {
  if (USE_MOCK) {
    await delay();
    const approved = MOCK_STREAMS.filter((s) => s.moderationState === 'approved');
    return category === 'all' ? approved : approved.filter((s) => s.category === category);
  }
  const res = await api.get(`${CONNECT_API_BASE}/live`, { params: { category } });
  return unwrap<LiveStream[]>(res);
}

export async function getLiveStream(id: string): Promise<LiveStream> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_STREAMS.find((s) => s.id === id) ?? MOCK_STREAMS[0];
  }
  const res = await api.get(`${CONNECT_API_BASE}/live/${id}`);
  return unwrap<LiveStream>(res);
}

// ── Chat (LV-04) ─────────────────────────────────────────────────────────────
const MOCK_CHAT: LiveChatMessage[] = [
  { id: 'm1', userId: 'u1', userName: 'Bisi', text: 'This set is fire 🔥', sentAtIso: new Date().toISOString() },
  { id: 'm2', userId: 'u2', userName: 'Femi', text: 'Sent you a rose!', sentAtIso: new Date().toISOString() },
  { id: 'm3', userId: 'h1', userName: 'DJ Kemi', text: 'Thank you all ❤️', sentAtIso: new Date().toISOString(), isHost: true },
];

export async function getLiveChat(streamId: string): Promise<LiveChatMessage[]> {
  if (USE_MOCK) {
    await delay(180);
    return MOCK_CHAT.map((m) => ({ ...m }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/live/${streamId}/chat`);
  return unwrap<LiveChatMessage[]>(res);
}

export async function sendLiveChat(streamId: string, text: string): Promise<LiveChatMessage> {
  if (USE_MOCK) {
    await delay(120);
    return { id: `m_${Date.now()}`, userId: 'me', userName: 'You', text, sentAtIso: new Date().toISOString() };
  }
  const res = await api.post(`${CONNECT_API_BASE}/live/${streamId}/chat`, { text });
  return unwrap<LiveChatMessage>(res);
}

// ── Gifts (LV-06..LV-08) — REAL MONEY ────────────────────────────────────────
const MOCK_GIFTS: LiveGift[] = [
  { id: 'g_flower', name: 'Flower', icon: 'sparkles', priceKobo: 5_000, tierMin: 1 },     // ₦50
  { id: 'g_heart', name: 'Heart', icon: 'heart', priceKobo: 10_000, tierMin: 1 },         // ₦100
  { id: 'g_star', name: 'Star', icon: 'star', priceKobo: 50_000, tierMin: 1 },            // ₦500
  { id: 'g_gem', name: 'Gem', icon: 'gem', priceKobo: 200_000, tierMin: 1 },              // ₦2,000
  { id: 'g_crown', name: 'Crown', icon: 'crown', priceKobo: 1_000_000, tierMin: 2 },      // ₦10,000
  { id: 'g_rocket', name: 'Rocket', icon: 'rocket', priceKobo: 5_000_000, tierMin: 2 },   // ₦50,000
];

export async function listGifts(): Promise<LiveGift[]> {
  if (USE_MOCK) {
    await delay(140);
    return MOCK_GIFTS.map((g) => ({ ...g }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/live/gifts`);
  return unwrap<LiveGift[]>(res);
}

// sendGift moves REAL Naira. MUST carry an Idempotency-Key (money-handling rule).
export async function sendGift(args: {
  streamId: string;
  giftId: string;
  amountKobo: number;
  idempotencyKey: string;
}): Promise<GiftSendResult> {
  if (USE_MOCK) {
    await delay(420);
    return {
      ok: true,
      giftId: args.giftId,
      amountKobo: args.amountKobo,
      newRemainingKobo: Math.max(0, 1_850_000 - args.amountKobo),
      ledgerRef: `lgr_${Date.now()}`,
    };
  }
  const res = await api.post(
    `${CONNECT_API_BASE}/live/${args.streamId}/gifts`,
    { giftId: args.giftId, amountKobo: args.amountKobo },
    { headers: { 'Idempotency-Key': args.idempotencyKey } },
  );
  return unwrap<GiftSendResult>(res);
}

// ── PK battle (LV-05) ────────────────────────────────────────────────────────
const MOCK_PK: PkBattle = {
  id: 'pk_1', durationSec: 300, remainingSec: 142, state: 'live',
  teamA: { hostId: 'h2a', hostName: 'Tomi', hostAvatar: AV('tomi'), scoreKobo: 3_450_000, topGifter: 'Femi' },
  teamB: { hostId: 'h2b', hostName: 'Bola', hostAvatar: AV('bola'), scoreKobo: 2_980_000, topGifter: 'Ada' },
};

export async function getPkBattle(streamId: string): Promise<PkBattle> {
  if (USE_MOCK) {
    await delay(200);
    return JSON.parse(JSON.stringify(MOCK_PK));
  }
  const res = await api.get(`${CONNECT_API_BASE}/live/${streamId}/pk`);
  return unwrap<PkBattle>(res);
}

// ── Leaderboard (LV-09) ──────────────────────────────────────────────────────
const MOCK_LB_GIFTERS: LiveLeaderboardEntry[] = [
  { rank: 1, userId: 'u_femi', name: 'Femi', avatar: AV('femi'), amountKobo: 1_250_000 },
  { rank: 2, userId: 'u_ada', name: 'Ada', avatar: AV('ada'), amountKobo: 880_000 },
  { rank: 3, userId: 'u_bisi', name: 'Bisi', avatar: AV('bisi'), amountKobo: 540_000 },
  { rank: 4, userId: 'u_kola', name: 'Kola', avatar: AV('kola'), amountKobo: 210_000 },
];
const MOCK_LB_STREAMERS: LiveLeaderboardEntry[] = [
  { rank: 1, userId: 'h2', name: 'Tomi & Bola', avatar: AV('tomi'), viewers: 3411 },
  { rank: 2, userId: 'h6', name: 'Naomi', avatar: AV('naomi'), viewers: 1502 },
  { rank: 3, userId: 'h1', name: 'DJ Kemi', avatar: AV('kemi'), viewers: 1284 },
];

export async function getLiveLeaderboard(kind: 'gifters' | 'streamers'): Promise<LiveLeaderboardEntry[]> {
  if (USE_MOCK) {
    await delay(220);
    return (kind === 'gifters' ? MOCK_LB_GIFTERS : MOCK_LB_STREAMERS).map((e) => ({ ...e }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/live/leaderboard`, { params: { kind } });
  return unwrap<LiveLeaderboardEntry[]>(res);
}

// ── Replays (LV-10) ──────────────────────────────────────────────────────────
const MOCK_REPLAYS: StreamReplay[] = [
  { id: 'rp_1', title: 'Sunday gospel hour', hostName: 'DJ Kemi', coverUrl: COVER('gospel'), durationSec: 4920, views: 8400, recordedAtIso: new Date(Date.now() - 86_400_000).toISOString(), giftRevenueKobo: 4_200_000 },
  { id: 'rp_2', title: 'Founder fireside', hostName: 'Chuka', coverUrl: COVER('fireside'), durationSec: 3600, views: 2100, recordedAtIso: new Date(Date.now() - 2 * 86_400_000).toISOString(), giftRevenueKobo: 980_000 },
];

export async function listReplays(): Promise<StreamReplay[]> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_REPLAYS.map((r) => ({ ...r }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/live/replays`);
  return unwrap<StreamReplay[]>(res);
}

// ── Co-host requests (LV-05 / LB-04) ─────────────────────────────────────────
const MOCK_COHOST: CoHostRequest[] = [
  { id: 'cr_1', fromUserId: 'u_ada', fromName: 'Ada', fromAvatar: AV('ada'), status: 'pending', requestedAtIso: new Date().toISOString() },
];

export async function listCoHostRequests(streamId: string): Promise<CoHostRequest[]> {
  if (USE_MOCK) {
    await delay(180);
    return MOCK_COHOST.map((c) => ({ ...c }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/live/${streamId}/cohost-requests`);
  return unwrap<CoHostRequest[]>(res);
}

export async function respondCoHostRequest(args: { streamId: string; requestId: string; accept: boolean }): Promise<CoHostRequest> {
  if (USE_MOCK) {
    await delay(220);
    return { ...MOCK_COHOST[0], status: args.accept ? 'accepted' : 'declined' };
  }
  const res = await api.post(`${CONNECT_API_BASE}/live/${args.streamId}/cohost-requests/${args.requestId}`, { accept: args.accept });
  return unwrap<CoHostRequest>(res);
}

// ── Report (LV-13) — always returns a caseId (SAFETY §7) ─────────────────────
const MOCK_REPORT_REASONS: StreamReportReason[] = [
  { code: 'nudity', label: 'Nudity or sexual content' },
  { code: 'harassment', label: 'Harassment or hate' },
  { code: 'violence', label: 'Violence or self-harm' },
  { code: 'scam', label: 'Scam, fraud or money solicitation', description: 'Asking viewers to send money off-platform, gift cards, crypto, or "emergency funds".' },
  { code: 'minor', label: 'Suspected minor' },
  { code: 'illegal', label: 'Illegal activity' },
  { code: 'other', label: 'Something else' },
];

export async function getStreamReportReasons(): Promise<StreamReportReason[]> {
  if (USE_MOCK) {
    await delay(120);
    return MOCK_REPORT_REASONS.map((r) => ({ ...r }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/live/report-reasons`);
  return unwrap<StreamReportReason[]>(res);
}

export async function reportStream(args: { streamId: string; reasonCode: string; details?: string }): Promise<StreamReportResult> {
  if (USE_MOCK) {
    await delay(380);
    return { caseId: `CASE-${Math.floor(100000 + Math.random() * 899999)}`, status: 'received' };
  }
  const res = await api.post(`${CONNECT_API_BASE}/live/${args.streamId}/report`, { reasonCode: args.reasonCode, details: args.details });
  return unwrap<StreamReportResult>(res);
}

// ── Broadcaster (LB-*) ───────────────────────────────────────────────────────
const MOCK_PREFLIGHT: BroadcastPreflight = {
  tier: 2, tierLabel: 'Tier 2', canGoLive: true,
  cameraGranted: true, micGranted: true, networkOk: true,
};

export async function getBroadcastPreflight(): Promise<BroadcastPreflight> {
  if (USE_MOCK) {
    await delay(260);
    return { ...MOCK_PREFLIGHT };
  }
  const res = await api.get(`${CONNECT_API_BASE}/live/preflight`);
  return unwrap<BroadcastPreflight>(res);
}

const MOCK_SESSION: BroadcastSession = {
  id: 'bs_1', title: 'My live show', viewerCount: 312, peakViewers: 540, newFollowers: 24,
  earningsKobo: 1_650_000, elapsedSec: 1240, coHostName: undefined, muted: false,
};

export async function getBroadcastSession(): Promise<BroadcastSession> {
  if (USE_MOCK) {
    await delay(240);
    return { ...MOCK_SESSION };
  }
  const res = await api.get(`${CONNECT_API_BASE}/live/session`);
  return unwrap<BroadcastSession>(res);
}

export async function startBroadcast(args: { title: string; category: string; tags: string[]; shareLocation: boolean }): Promise<BroadcastSession> {
  if (USE_MOCK) {
    await delay(420);
    return { ...MOCK_SESSION, title: args.title };
  }
  const res = await api.post(`${CONNECT_API_BASE}/live/start`, args);
  return unwrap<BroadcastSession>(res);
}

const MOCK_VIEWERS: LiveViewer[] = [
  { id: 'v1', name: 'Femi', avatar: AV('femi'), isMuted: false, isCoHost: false, joinedAtIso: new Date().toISOString() },
  { id: 'v2', name: 'Ada', avatar: AV('ada'), isMuted: false, isCoHost: true, joinedAtIso: new Date().toISOString() },
  { id: 'v3', name: 'Kola', avatar: AV('kola'), isMuted: true, isCoHost: false, joinedAtIso: new Date().toISOString() },
  { id: 'v4', name: 'Bisi', avatar: AV('bisi'), isMuted: false, isCoHost: false, joinedAtIso: new Date().toISOString() },
];

export async function listLiveViewers(): Promise<LiveViewer[]> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_VIEWERS.map((v) => ({ ...v }));
  }
  const res = await api.get(`${CONNECT_API_BASE}/live/session/viewers`);
  return unwrap<LiveViewer[]>(res);
}

export async function moderateViewer(args: { viewerId: string; action: 'mute' | 'unmute' | 'kick' | 'ban' }): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay(220);
    return { ok: true };
  }
  const res = await api.post(`${CONNECT_API_BASE}/live/session/moderate`, args);
  return unwrap<{ ok: boolean }>(res);
}

const MOCK_SUMMARY: StreamSummary = {
  durationSec: 3120, peakViewers: 540, newFollowers: 24,
  giftRevenueKobo: 1_650_000, voteRevenueKobo: 320_000, totalEarningsKobo: 1_970_000,
  topGifters: [
    { name: 'Femi', amountKobo: 800_000 },
    { name: 'Ada', amountKobo: 540_000 },
    { name: 'Kola', amountKobo: 210_000 },
  ],
};

export async function getStreamSummary(): Promise<StreamSummary> {
  if (USE_MOCK) {
    await delay(260);
    return JSON.parse(JSON.stringify(MOCK_SUMMARY));
  }
  const res = await api.get(`${CONNECT_API_BASE}/live/session/summary`);
  return unwrap<StreamSummary>(res);
}
