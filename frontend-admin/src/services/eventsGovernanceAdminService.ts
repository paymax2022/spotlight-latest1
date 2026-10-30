// Events governance admin: moderation queue, organiser sanctions, platform fee
// and support desk. Live routes are /api/events/admin/* registered by
// backend/internal/top5events/commerce_handler.go RegisterCommerce (mounted only
// under FEATURE_EVENTS_COMMERCIAL, so with the flag off every call 404s).
// Same NEXT_PUBLIC_EVENTS_USE_MOCK switch as eventsAdminService: mock READS
// return small fixtures; mock WRITES throw — this console never reports a write
// it did not perform.

import { apiRoot } from '@/config/env';
import { resolveUseMock } from '@/config/useMock';
import type {
  ModerationQueueItem, ModerationAction, ModerationDecision, FeeSettings, OrganiserSanction,
  SupportCase, SupportMessage, SupportQueueStats, SupportCaseUpdate,
} from '@/types/eventsGovernanceAdmin';

export const USE_MOCK = resolveUseMock(process.env.NEXT_PUBLIC_EVENTS_USE_MOCK);
export const USE_MOCK_ENV = 'NEXT_PUBLIC_EVENTS_USE_MOCK';

const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Set NEXT_PUBLIC_EVENTS_USE_MOCK=false to make this change against the live backend.';

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const enc = encodeURIComponent;

// Go handlers answer {"success":true,"data":...} or {"error":"..."}; surface the
// error text so a 409/400 reads as a reason, not a bare status code.
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiRoot()}/api/events/admin${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error ? `${j.error} (${res.status})` : `Request failed (${res.status})`);
  return j?.data as T;
}
const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => { if (v) p.set(k, v); });
  return p.toString() ? `?${p}` : '';
};
const has = (q: string | undefined, ...vals: (string | undefined)[]) => !q || vals.some((v) => v?.toLowerCase().includes(q.toLowerCase()));

// --- moderation (guard events.moderate) ---

const MOD_QUEUE: ModerationQueueItem[] = [
  { id: 'evt_mock_m1', title: 'Fixture Live Concert', organiser_masked: 'Fixture Org•••', category: 'Concert', city: 'Lagos', status: 'submitted', starts_at: iso(-500), capacity: 2000, tickets_sold: 0, gmv_kobo: 0, cashless_enabled: true, created_at: iso(60), submitted_at: iso(6), refund_policy: 'FLEXIBLE' },
  { id: 'evt_mock_m2', title: 'Fixture Comedy Night', organiser_masked: 'Fixture Laughs•••', category: 'Comedy', city: 'Abuja', status: 'suspended', starts_at: iso(-200), capacity: 500, tickets_sold: 120, gmv_kobo: 1_200_000_00, cashless_enabled: false, created_at: iso(300), moderation_note: 'Venue licence query' },
];
export async function listModerationQueue(o: { status?: string; q?: string } = {}): Promise<ModerationQueueItem[]> {
  if (USE_MOCK) { await delay(); return MOD_QUEUE.filter((e) => e.status === (o.status || 'submitted') && has(o.q, e.title)); }
  return (await call<ModerationQueueItem[]>('GET', `/moderation${qs(o)}`)) ?? [];
}
export async function getModerationTrail(eventId: string): Promise<ModerationDecision[]> {
  if (USE_MOCK) { await delay(); return [{ id: 'md_mock_1', event_id: eventId, action: 'submit', from_state: 'DRAFT', to_state: 'SUBMITTED', actor_name: 'Fixture Org', created_at: iso(6) }]; }
  return (await call<ModerationDecision[]>('GET', `/events/${enc(eventId)}/moderation`)) ?? [];
}
export async function reviewEvent(eventId: string, action: ModerationAction, reason: string): Promise<void> {
  if (USE_MOCK) throw new Error(`Moderating an event ${NOT_IN_FIXTURE_MODE}`);
  await call<null>('POST', `/events/${enc(eventId)}/review/${action}`, { reason });
}

// --- organisers (guard events.organisers) ---

const ORGANISERS: OrganiserSanction[] = [
  { organiser_id: 'org_mock_1', name: 'Fixture Org', suspended: false, event_total: 4, event_live: 1, event_under_review: 1, tickets_sold: 1840 },
  { organiser_id: 'org_mock_2', name: 'Fixture Promoter', suspended: true, reason: 'Repeated chargebacks', decided_by: 'usr_mock_admin', decided_at: iso(72), event_total: 2, event_live: 0, event_under_review: 0, tickets_sold: 90 },
];
export async function listOrganisers(q?: string): Promise<OrganiserSanction[]> {
  if (USE_MOCK) { await delay(); return ORGANISERS.filter((o) => has(q, o.name, o.organiser_id)); }
  return (await call<OrganiserSanction[]>('GET', `/organisers${qs({ q, limit: '200' })}`)) ?? [];
}
export async function getOrganiser(id: string): Promise<OrganiserSanction> {
  if (USE_MOCK) { await delay(); return ORGANISERS.find((o) => o.organiser_id === id) ?? { ...ORGANISERS[0], organiser_id: id }; }
  return call<OrganiserSanction>('GET', `/organisers/${enc(id)}`);
}
export async function sanctionOrganiser(id: string, suspended: boolean, reason: string): Promise<OrganiserSanction> {
  if (USE_MOCK) throw new Error(`Sanctioning an organiser ${NOT_IN_FIXTURE_MODE}`);
  return call<OrganiserSanction>('POST', `/organisers/${enc(id)}/sanction`, { suspended, reason });
}

// --- platform fee (guard events.fees) ---

export async function getFees(): Promise<FeeSettings> {
  if (USE_MOCK) { await delay(); return { fee_bps: 500, updated_by: 'usr_mock_admin', updated_at: iso(400) }; }
  return call<FeeSettings>('GET', '/fees');
}
export async function setFees(fee_bps: number, reason: string): Promise<FeeSettings> {
  if (USE_MOCK) throw new Error(`Changing the platform fee ${NOT_IN_FIXTURE_MODE}`);
  return call<FeeSettings>('PUT', '/fees', { fee_bps, reason });
}

// --- support desk (guard events.support) ---

const CASES: SupportCase[] = [
  { id: 'cs_mock_1', event_id: 'evt_mock_m1', event_title: 'Fixture Live Concert', opened_by: 'usr_mock_1', kind: 'REFUND', subject: 'Refund not received', body: 'My refund was approved two days ago.', status: 'OPEN', priority: 'high', created_at: iso(30), updated_at: iso(30), reply_count: 0 },
  { id: 'cs_mock_2', opened_by: 'usr_mock_2', kind: 'CHECKIN', subject: 'QR code would not scan', body: 'Gate staff could not scan my pass.', status: 'IN_PROGRESS', priority: 'normal', assigned_to: 'usr_mock_admin', created_at: iso(80), updated_at: iso(10), reply_count: 1 },
];
export async function listSupportCases(o: { status?: string; kind?: string; q?: string } = {}): Promise<SupportCase[]> {
  if (USE_MOCK) { await delay(); return CASES.filter((c) => (!o.status || c.status === o.status) && (!o.kind || c.kind === o.kind) && has(o.q, c.subject, c.body)); }
  return (await call<SupportCase[]>('GET', `/support/queue${qs({ ...o, limit: '200' })}`)) ?? [];
}
export async function getSupportStats(): Promise<SupportQueueStats> {
  if (USE_MOCK) { await delay(); return { open: 1, in_progress: 1, resolved_today: 0, by_priority: { high: 1, normal: 1 }, oldest_open_at: iso(30) }; }
  return call<SupportQueueStats>('GET', '/support/queue/stats');
}
export async function getSupportCase(id: string): Promise<SupportCase> {
  if (USE_MOCK) {
    await delay();
    const c = CASES.find((x) => x.id === id) ?? CASES[0];
    return { ...c, messages: [{ id: 'msg_mock_1', case_id: c.id, author_id: c.opened_by, author_name: 'Fixture Buyer', body: c.body, created_at: c.created_at }] };
  }
  return call<SupportCase>('GET', `/support/cases/${enc(id)}`);
}
export async function replySupportCase(id: string, body: string): Promise<SupportMessage> {
  if (USE_MOCK) throw new Error(`Replying to a support case ${NOT_IN_FIXTURE_MODE}`);
  return call<SupportMessage>('POST', `/support/cases/${enc(id)}/replies`, { body });
}
export async function updateSupportCase(id: string, patch: SupportCaseUpdate): Promise<SupportCase> {
  if (USE_MOCK) throw new Error(`Updating a support case ${NOT_IN_FIXTURE_MODE}`);
  return call<SupportCase>('PATCH', `/support/cases/${enc(id)}`, patch);
}
