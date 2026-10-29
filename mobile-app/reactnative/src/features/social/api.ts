import { Platform } from 'react-native';
import { api } from '@/api/client';
import { USE_MOCK, API_BASE, AML_DAILY_LIMIT_KOBO, normalizeHandle } from './constants/social.constants';
import type {
  Cashtag,
  MyCashtag,
  ActivityItem,
  ActivityStatus,
  SendInput,
  RequestInput,
  PayResult,
  SplitBill,
  SplitStatus,
  ShareState,
  CreateSplitInput,
  GroupPool,
  CreatePoolInput,
  ContributeResult,
} from './types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

function idempotencyKey(): string {
  return `soc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const MOCK_ME: MyCashtag = {
  handle: '@you',
  displayName: 'You',
  avatarColor: '#340075',
  dailyLimitKobo: AML_DAILY_LIMIT_KOBO,
  remainingDailyKobo: 28_500_000,
};

const MOCK_DIRECTORY: Cashtag[] = [
  { id: 'u_bisi',  handle: '@bisi',  displayName: 'Bisi Adeyemi', avatarColor: '#0051D5', verified: true },
  { id: 'u_tunde', handle: '@tunde', displayName: 'Tunde Okafor', avatarColor: '#48B8AC', verified: false },
  { id: 'u_chidi', handle: '@chidi', displayName: 'Chidi Nwosu',  avatarColor: '#EAB308', verified: true },
  { id: 'u_ada',   handle: '@ada',   displayName: 'Ada Eze',       avatarColor: '#16A34A', verified: false },
  { id: 'u_femi',  handle: '@femi',  displayName: 'Femi Bakare',   avatarColor: '#DC2626', verified: true },
  { id: 'u_kemi',  handle: '@kemi',  displayName: 'Kemi Johnson',  avatarColor: '#9333EA', verified: false },
];

const MOCK_ACTIVITY: ActivityItem[] = [
  { id: 'a1', kind: 'received', status: 'completed', counterparty: '@bisi',  avatarColor: '#0051D5', amountKobo: 1_500_000, note: 'Lunch 🍜', createdAtISO: minsAgo(35) },
  { id: 'a2', kind: 'sent',     status: 'completed', counterparty: '@chidi', avatarColor: '#EAB308', amountKobo: 5_000_000, note: 'Rent share', createdAtISO: minsAgo(180) },
  { id: 'a3', kind: 'request',  status: 'pending',   counterparty: '@ada',   avatarColor: '#16A34A', amountKobo: 800_000,  note: 'Movie tix', createdAtISO: minsAgo(300) },
  { id: 'a4', kind: 'split',    status: 'pending',   counterparty: 'Dinner @ Nok', avatarColor: '#340075', amountKobo: 12_000_000, createdAtISO: minsAgo(1440) },
  { id: 'a5', kind: 'pool',     status: 'completed', counterparty: "Tunde's Birthday", avatarColor: '#48B8AC', amountKobo: 3_000_000, note: 'Contribution', createdAtISO: minsAgo(2880) },
  { id: 'a6', kind: 'sent',     status: 'declined',  counterparty: '@femi',  avatarColor: '#DC2626', amountKobo: 2_000_000, note: 'Cancelled', createdAtISO: minsAgo(4320) },
];

const MOCK_SPLITS: SplitBill[] = [
  {
    id: 's_dinner', title: 'Dinner @ Nok', status: 'collecting', mode: 'equal',
    totalKobo: 20_000_000, collectedKobo: 8_000_000, createdAtISO: minsAgo(1440),
    shares: [
      { id: 'sh1', name: 'You',   handle: '@you',   avatarColor: '#340075', amountKobo: 4_000_000, state: 'paid', isYou: true },
      { id: 'sh2', name: 'Bisi',  handle: '@bisi',  avatarColor: '#0051D5', amountKobo: 4_000_000, state: 'paid' },
      { id: 'sh3', name: 'Chidi', handle: '@chidi', avatarColor: '#EAB308', amountKobo: 4_000_000, state: 'pending' },
      { id: 'sh4', name: 'Ada',   handle: '@ada',   avatarColor: '#16A34A', amountKobo: 4_000_000, state: 'pending' },
      { id: 'sh5', name: 'Femi',  handle: '@femi',  avatarColor: '#DC2626', amountKobo: 4_000_000, state: 'pending' },
    ],
  },
  {
    id: 's_trip', title: 'Weekend trip fuel', status: 'settled', mode: 'custom',
    totalKobo: 15_000_000, collectedKobo: 15_000_000, createdAtISO: minsAgo(10080),
    shares: [
      { id: 'sh1', name: 'You',  handle: '@you',  avatarColor: '#340075', amountKobo: 9_000_000, state: 'paid', isYou: true },
      { id: 'sh2', name: 'Kemi', handle: '@kemi', avatarColor: '#9333EA', amountKobo: 6_000_000, state: 'paid' },
    ],
  },
];

const MOCK_POOLS: GroupPool[] = [
  {
    id: 'p_bday', title: "Tunde's Birthday", description: 'Surprise gift fund 🎂',
    status: 'open', goalKobo: 10_000_000, raisedKobo: 6_500_000,
    payoutRule: 'Organiser withdraws on the event date.', createdAtISO: minsAgo(2880),
    contributors: [
      { id: 'c1', name: 'You',   handle: '@you',   avatarColor: '#340075', amountKobo: 3_000_000 },
      { id: 'c2', name: 'Bisi',  handle: '@bisi',  avatarColor: '#0051D5', amountKobo: 2_000_000 },
      { id: 'c3', name: 'Ada',   handle: '@ada',   avatarColor: '#16A34A', amountKobo: 1_500_000 },
    ],
  },
  {
    id: 'p_relief', title: 'Flood relief', description: 'Community support',
    status: 'closed', goalKobo: 50_000_000, raisedKobo: 50_000_000,
    payoutRule: 'Released to verified beneficiary.', createdAtISO: minsAgo(20160),
    contributors: [
      { id: 'c1', name: 'You',  handle: '@you',  avatarColor: '#340075', amountKobo: 5_000_000 },
      { id: 'c2', name: 'Femi', handle: '@femi', avatarColor: '#DC2626', amountKobo: 10_000_000 },
    ],
  },
];

// dedicated "my cashtag summary" endpoint (limits/avatar) yet — we merge the
// handle response into the display shape and fall back to safe defaults for
// the fields the backend doesn't return (MISSING: GET /me profile summary).
export async function getMyCashtag(): Promise<MyCashtag> {
  if (USE_MOCK) { await delay(); return MOCK_ME; }
  let body: { handle?: { handle?: string; display_name?: string } | null } = {};
  try {
    const res = await api.get(`${API_BASE}/handle/me`);
    body = (res.data ?? {}) as typeof body;
  } catch (e) {
    // Backend returns 404 when the user has not claimed a cashtag yet.
    if ((e as { response?: { status?: number } })?.response?.status !== 404) throw e;
  }
  const hd = body.handle;
  return {
    handle: hd?.handle ?? null,
    displayName: hd?.display_name ?? 'You',
    avatarColor: MOCK_ME.avatarColor,
    remainingDailyKobo: AML_DAILY_LIMIT_KOBO,
    dailyLimitKobo: AML_DAILY_LIMIT_KOBO,
  };
}

// Backend: GET /activity returns activity feed with pagination support.
export async function getActivity(): Promise<ActivityItem[]> {
  if (USE_MOCK) { await delay(); return MOCK_ACTIVITY; }
  try {
    const res = await api.get(`${API_BASE}/activity`);
    const items = (res.data as { activity?: Array<{ kind: string; id: string; counterpart_id: string; amount_kobo: number; note: string; state?: string; created_at: string }> })?.activity ?? [];
    return items.map((item) => ({
      id: item.id,
      kind: item.kind as ActivityItem['kind'],
      status: (item.state || 'completed') as ActivityStatus,
      counterparty: item.counterpart_id,
      avatarColor: '#340075',
      amountKobo: item.amount_kobo,
      note: item.note || '',
      createdAtISO: item.created_at,
    }));
  } catch {
    return [];
  }
}

export async function resolveCashtag(handle: string): Promise<Cashtag | null> {
  const normalized = normalizeHandle(handle);
  if (USE_MOCK) {
    await delay(200);
    return MOCK_DIRECTORY.find((c) => c.handle === normalized) ?? null;
  }
  try {
    const res = await api.get(`${API_BASE}/handle/${encodeURIComponent(normalized.replace(/^@/, ''))}`);
    const userId = (res.data as { user_id?: string })?.user_id;
    if (!userId) return null;
    return { id: userId, handle: normalized, displayName: normalized, avatarColor: '#340075', verified: false };
  } catch {
    return null;
  }
}

// MISSING BACKEND ENDPOINT: no cashtag directory search exists server-side.
// Live mode can only resolve an exact handle; the mock directory (client-side
// filter) is dev-only so invented people never appear as real send targets.
export async function searchCashtags(query: string): Promise<Cashtag[]> {
  const q = query.trim().toLowerCase().replace(/^@/, '');
  if (!USE_MOCK) {
    if (!q) return [];
    const exact = await resolveCashtag(q);
    return exact ? [exact] : [];
  }
  await delay();
  if (!q) return MOCK_DIRECTORY;
  return MOCK_DIRECTORY.filter((c) => c.handle.includes(q) || c.displayName.toLowerCase().includes(q));
}

export interface PhoneContact { id: string; name: string; phone: string }
export interface PhoneContactsResult {
  /** granted: device book read; denied: user refused; unavailable: no address book (e.g. web) */
  access: 'granted' | 'denied' | 'unavailable';
  onPaymax: Array<Cashtag & { phone: string }>;
  others: PhoneContact[];
}

const phoneKey = (p: string) => p.replace(/\D/g, '').slice(-10);

// Reads the phone's address book (with permission) and asks the backend which
// numbers belong to people who claimed a cashtag. Only matched people can be paid.
export async function getContacts(): Promise<PhoneContactsResult> {
  if (USE_MOCK) {
    await delay();
    return { access: 'granted', onPaymax: MOCK_DIRECTORY.map((c) => ({ ...c, phone: '' })), others: [] };
  }
  if (Platform.OS === 'web') return { access: 'unavailable', onPaymax: [], others: [] };
  let device: PhoneContact[] | null;
  try {
    const { getDeviceContacts } = await import('@/lib/contacts');
    device = await getDeviceContacts();
  } catch {
    return { access: 'unavailable', onPaymax: [], others: [] };
  }
  if (!device) return { access: 'denied', onPaymax: [], others: [] };

  const phones = Array.from(new Set(device.map((c) => c.phone))).slice(0, 500);
  const res = await api.post(`${API_BASE}/contacts/match`, { phones });
  const matches = ((res.data as { matches?: Array<{ phone: string; handle: string; display_name: string }> })?.matches) ?? [];
  const byPhone = new Map(matches.map((m) => [m.phone, m]));

  const onPaymax: PhoneContactsResult['onPaymax'] = [];
  const others: PhoneContact[] = [];
  for (const c of device) {
    const m = byPhone.get(phoneKey(c.phone));
    if (m) {
      const handle = normalizeHandle(m.handle);
      onPaymax.push({ id: c.id, handle, displayName: c.name || m.display_name, avatarColor: '#340075', verified: false, phone: c.phone });
    } else {
      others.push(c);
    }
  }
  return { access: 'granted', onPaymax, others };
}

// Backend: GET /splits returns user's splits with pagination support.
export async function listSplits(): Promise<SplitBill[]> {
  if (USE_MOCK) { await delay(); return MOCK_SPLITS; }
  try {
    const res = await api.get(`${API_BASE}/splits`);
    const bills = (res.data as { splits?: Record<string, unknown>[] })?.splits ?? [];
    return bills.map((bill) => mapSplit(bill, undefined));
  } catch {
    return [];
  }
}

export async function getSplit(id: string): Promise<SplitBill> {
  if (USE_MOCK) {
    await delay();
    const s = MOCK_SPLITS.find((x) => x.id === id);
    if (!s) throw new Error('Split not found');
    return s;
  }
  const res = await api.get(`${API_BASE}/splits/${id}`);
  const body = (res.data ?? {}) as { bill?: Record<string, unknown>; shares?: SplitShareServer[] };
  return mapSplit(body.bill, body.shares);
}

// Backend: GET /pools returns user's pools with pagination support.
export async function listPools(): Promise<GroupPool[]> {
  if (USE_MOCK) { await delay(); return MOCK_POOLS; }
  try {
    const res = await api.get(`${API_BASE}/pools`);
    const pools = (res.data as { pools?: Array<{ id: string; title: string; description: string; status: string; goal_kobo: number; raised_kobo: number; created_at: string; contributors?: Array<{ id: string; name?: string; handle?: string; avatar_color?: string; amount_kobo: number }> }> })?.pools ?? [];
    return pools.map((pool) => ({
      id: pool.id,
      title: pool.title,
      description: pool.description,
      status: (pool.status.toLowerCase() as 'open' | 'closed'),
      goalKobo: pool.goal_kobo,
      raisedKobo: pool.raised_kobo,
      payoutRule: '',
      createdAtISO: pool.created_at,
      contributors: (pool.contributors ?? []).map((c) => ({
        id: c.id,
        name: c.name ?? c.handle ?? '',
        handle: c.handle ?? '',
        avatarColor: c.avatar_color ?? '#340075',
        amountKobo: c.amount_kobo,
      })),
    }));
  } catch {
    return [];
  }
}

// Backend: GET /pools/:id returns full pool details with contributors.
export async function getPool(id: string): Promise<GroupPool> {
  if (USE_MOCK) {
    await delay();
    const p = MOCK_POOLS.find((x) => x.id === id);
    if (!p) throw new Error('Pool not found');
    return p;
  }
  const res = await api.get(`${API_BASE}/pools/${id}`);
  const pool = (res.data ?? {}) as { pool?: { id: string; title: string; description: string; status: string; goal_kobo: number; raised_kobo: number; created_at: string; contributors?: Array<{ id: string; name?: string; handle?: string; avatar_color?: string; amount_kobo: number }> } };
  const p = pool.pool;
  if (!p) throw new Error('Pool not found');
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    status: (p.status.toLowerCase() as 'open' | 'closed'),
    goalKobo: p.goal_kobo,
    raisedKobo: p.raised_kobo,
    payoutRule: '',
    createdAtISO: p.created_at,
    contributors: (p.contributors ?? []).map((c) => ({
      id: c.id,
      name: c.name ?? c.handle ?? '',
      handle: c.handle ?? '',
      avatarColor: c.avatar_color ?? '#340075',
      amountKobo: c.amount_kobo,
    })),
  };
}

interface SplitShareServer {
  id: string;
  name?: string;
  handle?: string;
  avatar_color?: string;
  amount_kobo: number;
  state: string;
  is_you?: boolean;
}

function mapSplit(bill?: Record<string, unknown>, shares?: SplitShareServer[]): SplitBill {
  return {
    id: String(bill?.id ?? ''),
    title: String(bill?.title ?? ''),
    status: (bill?.status as SplitStatus) ?? 'collecting',
    totalKobo: Number(bill?.total_kobo ?? 0),
    collectedKobo: Number(bill?.collected_kobo ?? 0),
    mode: ((bill?.mode as string)?.toLowerCase() as 'equal' | 'custom') ?? 'equal',
    createdAtISO: String(bill?.created_at ?? new Date().toISOString()),
    shares: (shares ?? []).map((s) => ({
      id: s.id,
      name: s.name ?? s.handle ?? '',
      handle: s.handle ?? '',
      avatarColor: s.avatar_color ?? '#340075',
      amountKobo: s.amount_kobo,
      state: (s.state?.toLowerCase() as ShareState) ?? 'pending',
      isYou: s.is_you,
    })),
  };
}

// Backend: POST /send expects { handle, amount_kobo, note } → { success, payment }.
export async function sendMoney(input: SendInput): Promise<PayResult> {
  if (USE_MOCK) { await delay(); return { id: `pay_${Date.now()}`, ok: true, status: 'completed' }; }
  const res = await api.post(
    `${API_BASE}/send`,
    { handle: input.toHandle, amount_kobo: input.amountKobo, note: input.note },
    { headers: { 'Idempotency-Key': idempotencyKey() } },
  );
  const payment = (res.data as { payment?: { id?: string; status?: string } })?.payment;
  return { id: payment?.id ?? `pay_${Date.now()}`, ok: true, status: (payment?.status as ActivityStatus) ?? 'completed' };
}

// Backend: POST /requests expects { handle, amount_kobo, note } → { success, request }.
// NOTE: the endpoint is /requests (plural), not /request.
export async function requestMoney(input: RequestInput): Promise<PayResult> {
  if (USE_MOCK) { await delay(); return { id: `req_${Date.now()}`, ok: true, status: 'pending' }; }
  const res = await api.post(
    `${API_BASE}/requests`,
    { handle: input.fromHandle, amount_kobo: input.amountKobo, note: input.note },
    { headers: { 'Idempotency-Key': idempotencyKey() } },
  );
  const request = (res.data as { request?: { id?: string } })?.request;
  return { id: request?.id ?? `req_${Date.now()}`, ok: true, status: 'pending' };
}

// Backend: POST /handle expects { handle } → { success, handle }. NOTE: the
// endpoint is /handle (not /cashtag) and does not require an Idempotency-Key.
export async function setupCashtag(handle: string): Promise<{ ok: boolean; handle: string }> {
  if (USE_MOCK) { await delay(); return { ok: true, handle: normalizeHandle(handle) }; }
  const res = await api.post(`${API_BASE}/handle`, { handle: normalizeHandle(handle) });
  const hd = (res.data as { handle?: { handle?: string } })?.handle;
  return { ok: true, handle: hd?.handle ?? normalizeHandle(handle) };
}

// Backend: POST /splits expects { title, total_kobo, mode, shares } → { success, bill, shares }.
export async function createSplit(input: CreateSplitInput): Promise<SplitBill> {
  if (USE_MOCK) {
    await delay();
    return {
      id: `s_${Date.now()}`, title: input.title, status: 'collecting', mode: input.mode,
      totalKobo: input.totalKobo, collectedKobo: 0, createdAtISO: new Date().toISOString(),
      shares: input.participants.map((p, i) => ({
        id: `sh_${i}`, name: p.handle.replace('@', ''), handle: p.handle,
        avatarColor: ['#340075', '#0051D5', '#48B8AC', '#EAB308', '#16A34A'][i % 5],
        amountKobo: p.amountKobo, state: i === 0 ? 'paid' : 'pending', isYou: i === 0,
      })),
    };
  }
  const res = await api.post(
    `${API_BASE}/splits`,
    {
      title: input.title,
      total_kobo: input.totalKobo,
      mode: input.mode.toUpperCase(),
      shares: input.participants.map((p) => ({ handle: p.handle, amount_kobo: p.amountKobo })),
    },
    { headers: { 'Idempotency-Key': idempotencyKey() } },
  );
  const body = (res.data ?? {}) as { bill?: Record<string, unknown>; shares?: SplitShareServer[] };
  return mapSplit(body.bill, body.shares);
}

// empty (amount is fixed by the share) → { success }. amountKobo is accepted
// here for the mock path only.
export async function paySplitShare(splitId: string, shareId: string, amountKobo: number): Promise<PayResult> {
  if (USE_MOCK) { await delay(); return { id: `pay_${Date.now()}`, ok: true, status: 'completed' }; }
  await api.post(
    `${API_BASE}/splits/${splitId}/shares/${shareId}/pay`,
    {},
    { headers: { 'Idempotency-Key': idempotencyKey() } },
  );
  return { id: `pay_${Date.now()}`, ok: true, status: 'completed' };
}

// Backend: POST /pools expects { title, beneficiary_id } → { success, pool }.
// goalKobo/description/payoutRule have no backend field yet (MISSING) — kept
// client-side for display until the backend adds them.
export async function createPool(input: CreatePoolInput): Promise<GroupPool> {
  if (USE_MOCK) {
    await delay();
    return {
      id: `p_${Date.now()}`, title: input.title, description: input.description,
      status: 'open', goalKobo: input.goalKobo, raisedKobo: 0, payoutRule: input.payoutRule,
      createdAtISO: new Date().toISOString(),
      contributors: [{ id: 'c1', name: 'You', handle: '@you', avatarColor: '#340075', amountKobo: 0 }],
    };
  }
  const res = await api.post(`${API_BASE}/pools`, { title: input.title });
  const pool = (res.data as { pool?: { id?: string; created_at?: string } })?.pool;
  return {
    id: pool?.id ?? `p_${Date.now()}`,
    title: input.title,
    description: input.description,
    status: 'open',
    goalKobo: input.goalKobo,
    raisedKobo: 0,
    payoutRule: input.payoutRule,
    createdAtISO: pool?.created_at ?? new Date().toISOString(),
    contributors: [],
  };
}

// header) → { success, balance_kobo }.
export async function contributeToPool(poolId: string, amountKobo: number): Promise<ContributeResult> {
  if (USE_MOCK) {
    await delay();
    const p = MOCK_POOLS.find((x) => x.id === poolId);
    return { ok: true, raisedKobo: (p?.raisedKobo ?? 0) + amountKobo };
  }
  const res = await api.post(
    `${API_BASE}/pools/${poolId}/contribute`,
    { amount_kobo: amountKobo },
    { headers: { 'Idempotency-Key': idempotencyKey() } },
  );
  return { ok: true, raisedKobo: Number((res.data as { balance_kobo?: number })?.balance_kobo ?? 0) };
}
