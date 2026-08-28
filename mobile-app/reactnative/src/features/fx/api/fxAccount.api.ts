// ── FX Exchange — Account API (business, notifications, settings) ─────────────
// Covers spec I (business/multi-user), J (notifications), K (settings).
// Mock-flagged; flip USE_MOCK=false once endpoints land. Money in minor units.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import type {
  TeamMember, TeamRole, ApprovalRequest, ApprovalThreshold, ActivityEvent,
  TeamApiKey, WebhookSetting, AppNotification, FxSettings, NotificationPrefs,
  StablecoinAddress, TierLimits, CurrencyCode,
} from '../types/fx.types';

const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_FX_USE_MOCK, true);
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));
// Unwrap { data: ... } by key presence so an empty { data: null } yields null,
// not the wrapper object (see fx.api.ts). arr() coerces list payloads to arrays.
const unwrap = <T>(res: { data: unknown }): T => {
  const body = res?.data;
  if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return (body as { data: T }).data;
  }
  return body as T;
};
const arr = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

// ─── Business / multi-user ────────────────────────────────────────────────────

let TEAM: TeamMember[] = [
  { id: 'm1', name: 'Ada Obi', email: 'ada@acme.example', role: 'OWNER', status: 'ACTIVE', lastActiveAt: iso(3_600_000) },
  { id: 'm2', name: 'Tunde A.', email: 'tunde@acme.example', role: 'APPROVER', status: 'ACTIVE', lastActiveAt: iso(86_400_000) },
  { id: 'm3', name: 'Ngozi E.', email: 'ngozi@acme.example', role: 'INITIATOR', status: 'ACTIVE', lastActiveAt: iso(2 * 86_400_000) },
  { id: 'm4', name: 'Sam K.', email: 'sam@acme.example', role: 'VIEWER', status: 'INVITED', lastActiveAt: null },
];

let APPROVALS: ApprovalRequest[] = [
  { id: 'ap1', type: 'transfer', reference: 'PMX-TR-88010', amount: { amount: 250_000_00, currency: 'NGN' }, destination: 'Amara Okafor · GTBank', initiator: 'Ngozi E.', createdAt: iso(1_800_000), status: 'PENDING', threshold: 100_000_00 },
  { id: 'ap2', type: 'bulk_payout', reference: 'PMX-BULK-2231', amount: { amount: 4_200_00, currency: 'USD' }, destination: '18 beneficiaries', initiator: 'Ngozi E.', createdAt: iso(5_400_000), status: 'PENDING', threshold: 1_000_00 },
  { id: 'ap3', type: 'conversion', reference: 'PMX-CV-90130', amount: { amount: 5_000_00, currency: 'USD' }, destination: 'USD → NGN', initiator: 'Tunde A.', createdAt: iso(86_400_000), status: 'APPROVED', threshold: 2_000_00 },
];

let THRESHOLDS: ApprovalThreshold[] = [
  { id: 'th1', label: 'Single payout', currency: 'USD', amount: 1_000_00, approversRequired: 1 },
  { id: 'th2', label: 'Single conversion', currency: 'USD', amount: 5_000_00, approversRequired: 1 },
  { id: 'th3', label: 'Bulk payout total', currency: 'USD', amount: 2_000_00, approversRequired: 2 },
];

const ACTIVITY: ActivityEvent[] = [
  { id: 'ac1', actor: 'Ngozi E.', action: 'Initiated payout', target: 'PMX-TR-88010', at: iso(1_800_000), kind: 'payout' },
  { id: 'ac2', actor: 'Tunde A.', action: 'Approved conversion', target: 'PMX-CV-90130', at: iso(86_400_000), kind: 'approval' },
  { id: 'ac3', actor: 'Ada Obi', action: 'Rotated API key', target: 'Production', at: iso(2 * 86_400_000), kind: 'security' },
  { id: 'ac4', actor: 'Ada Obi', action: 'Updated approval threshold', target: 'Single payout', at: iso(3 * 86_400_000), kind: 'config' },
  { id: 'ac5', actor: 'Sam K.', action: 'Was invited as Viewer', target: null, at: iso(4 * 86_400_000), kind: 'auth' },
];

let API_KEYS: TeamApiKey[] = [
  { id: 'k1', label: 'Production', prefix: 'sk_live_8x21', mode: 'live', createdAt: iso(40 * 86_400_000), lastUsed: iso(3_600_000) },
  { id: 'k2', label: 'Sandbox', prefix: 'sk_test_4a90', mode: 'sandbox', createdAt: iso(40 * 86_400_000), lastUsed: iso(86_400_000) },
];

let WEBHOOKS: WebhookSetting[] = [
  { id: 'wh1', url: 'https://acme.example/hooks/paymax', events: ['transfer.paid', 'conversion.settled', 'collection.received'], enabled: true },
];

export async function getTeam(): Promise<TeamMember[]> {
  if (USE_MOCK) { await delay(); return [...TEAM]; }
  return arr(unwrap<TeamMember[]>(await api.get('/api/v1/fx/team')));
}
export async function updateMemberRole(id: string, role: TeamRole): Promise<void> {
  if (USE_MOCK) { await delay(250); TEAM = TEAM.map((m) => (m.id === id ? { ...m, role } : m)); return; }
  await api.patch(`/api/v1/fx/team/${id}`, { role });
}
export async function getApprovals(): Promise<ApprovalRequest[]> {
  if (USE_MOCK) { await delay(); return [...APPROVALS].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)); }
  return arr(unwrap<ApprovalRequest[]>(await api.get('/api/v1/fx/approvals')));
}
export async function decideApproval(id: string, decision: 'APPROVED' | 'REJECTED'): Promise<void> {
  if (USE_MOCK) { await delay(400); APPROVALS = APPROVALS.map((a) => (a.id === id ? { ...a, status: decision } : a)); return; }
  await api.post(`/api/v1/fx/approvals/${id}/${decision === 'APPROVED' ? 'approve' : 'reject'}`, {});
}
export async function getThresholds(): Promise<ApprovalThreshold[]> {
  if (USE_MOCK) { await delay(); return [...THRESHOLDS]; }
  return arr(unwrap<ApprovalThreshold[]>(await api.get('/api/v1/fx/approvals/thresholds')));
}
export async function updateThreshold(id: string, amount: number, approversRequired: number): Promise<void> {
  if (USE_MOCK) { await delay(300); THRESHOLDS = THRESHOLDS.map((t) => (t.id === id ? { ...t, amount, approversRequired } : t)); return; }
  await api.patch(`/api/v1/fx/approvals/thresholds/${id}`, { amount, approversRequired });
}
export async function getActivity(): Promise<ActivityEvent[]> {
  if (USE_MOCK) { await delay(); return [...ACTIVITY]; }
  return arr(unwrap<ActivityEvent[]>(await api.get('/api/v1/fx/activity')));
}
export async function getApiKeys(): Promise<TeamApiKey[]> {
  if (USE_MOCK) { await delay(); return [...API_KEYS]; }
  return arr(unwrap<TeamApiKey[]>(await api.get('/api/v1/fx/api-keys')));
}
export async function rotateApiKey(id: string): Promise<TeamApiKey> {
  if (USE_MOCK) {
    await delay(500);
    const fresh = Math.random().toString(36).slice(2, 6);
    API_KEYS = API_KEYS.map((k) => (k.id === id ? { ...k, prefix: `${k.mode === 'live' ? 'sk_live' : 'sk_test'}_${fresh}`, createdAt: new Date().toISOString(), lastUsed: null } : k));
    return API_KEYS.find((k) => k.id === id)!;
  }
  return unwrap<TeamApiKey>(await api.post(`/api/v1/fx/api-keys/${id}/rotate`, {}));
}
export async function getWebhookSettings(): Promise<WebhookSetting[]> {
  if (USE_MOCK) { await delay(); return [...WEBHOOKS]; }
  return arr(unwrap<WebhookSetting[]>(await api.get('/api/v1/fx/webhooks')));
}
export async function toggleWebhook(id: string, enabled: boolean): Promise<void> {
  if (USE_MOCK) { await delay(250); WEBHOOKS = WEBHOOKS.map((w) => (w.id === id ? { ...w, enabled } : w)); return; }
  await api.patch(`/api/v1/fx/webhooks/${id}`, { enabled });
}

// ─── Notifications ────────────────────────────────────────────────────────────

let NOTIFICATIONS: AppNotification[] = [
  { id: 'n1', kind: 'rate_alert', title: 'USD/NGN hit your target', body: 'USD/NGN is now ₦1,650 — above your alert of ₦1,650.', read: false, createdAt: iso(900_000), deeplink: '/fx/convert' },
  { id: 'n2', kind: 'payout', title: 'Payout paid', body: 'Your ₦250,000 payout to Amara Okafor was paid.', read: false, createdAt: iso(3_600_000), deeplink: '/fx/transactions' },
  { id: 'n3', kind: 'collection', title: 'Money received', body: 'You received $1,200 from Stripe Payouts.', read: false, createdAt: iso(86_400_000), deeplink: '/fx/receive' },
  { id: 'n4', kind: 'approval', title: 'Approval needed', body: 'Ngozi E. initiated a $4,200 bulk payout awaiting your approval.', read: true, createdAt: iso(2 * 86_400_000), deeplink: '/fx/business/approvals' },
  { id: 'n5', kind: 'verification', title: 'Verification approved', body: 'Your account is verified. All FX features are unlocked.', read: true, createdAt: iso(3 * 86_400_000), deeplink: '/fx/kyc/status' },
  { id: 'n6', kind: 'security', title: 'New device sign-in', body: 'A new device signed in to your account.', read: true, createdAt: iso(5 * 86_400_000) },
];

export async function getNotifications(): Promise<AppNotification[]> {
  if (USE_MOCK) { await delay(); return [...NOTIFICATIONS].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)); }
  return arr(unwrap<AppNotification[]>(await api.get('/api/v1/fx/notifications')));
}
export async function markNotificationRead(id: string): Promise<void> {
  if (USE_MOCK) { await delay(120); NOTIFICATIONS = NOTIFICATIONS.map((n) => (n.id === id ? { ...n, read: true } : n)); return; }
  await api.patch(`/api/v1/fx/notifications/${id}`, { read: true });
}
export async function markAllNotificationsRead(): Promise<void> {
  if (USE_MOCK) { await delay(200); NOTIFICATIONS = NOTIFICATIONS.map((n) => ({ ...n, read: true })); return; }
  await api.post('/api/v1/fx/notifications/read-all', {});
}

// ─── Settings ─────────────────────────────────────────────────────────────────

let SETTINGS: FxSettings = {
  defaultCurrency: 'NGN',
  displayRate: 'all_in',
  language: 'English',
  theme: 'system',
  biometricEnabled: true,
  twoFactorEnabled: false,
  notifications: { payouts: true, conversions: true, collections: true, rateAlerts: true, security: true, approvals: true },
  stablecoinAddresses: [
    { id: 'sc1', label: 'My USDC wallet', asset: 'USDC', network: 'Base', address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' },
  ],
};

export async function getSettings(): Promise<FxSettings> {
  if (USE_MOCK) { await delay(); return { ...SETTINGS }; }
  return unwrap<FxSettings>(await api.get('/api/v1/fx/settings'));
}
export async function updateSettings(patch: Partial<FxSettings>): Promise<FxSettings> {
  if (USE_MOCK) { await delay(250); SETTINGS = { ...SETTINGS, ...patch }; return { ...SETTINGS }; }
  return unwrap<FxSettings>(await api.patch('/api/v1/fx/settings', patch));
}
export async function updateNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  if (USE_MOCK) { await delay(200); SETTINGS = { ...SETTINGS, notifications: prefs }; return; }
  await api.patch('/api/v1/fx/settings/notifications', prefs);
}
export async function addStablecoinAddress(addr: Omit<StablecoinAddress, 'id'>): Promise<StablecoinAddress> {
  if (USE_MOCK) { await delay(300); const created = { ...addr, id: `sc_${Date.now()}` }; SETTINGS = { ...SETTINGS, stablecoinAddresses: [...SETTINGS.stablecoinAddresses, created] }; return created; }
  return unwrap<StablecoinAddress>(await api.post('/api/v1/fx/settings/stablecoin-addresses', addr));
}
export async function removeStablecoinAddress(id: string): Promise<void> {
  if (USE_MOCK) { await delay(200); SETTINGS = { ...SETTINGS, stablecoinAddresses: SETTINGS.stablecoinAddresses.filter((a) => a.id !== id) }; return; }
  await api.delete(`/api/v1/fx/settings/stablecoin-addresses/${id}`);
}

export async function getTierLimits(): Promise<TierLimits> {
  if (USE_MOCK) {
    await delay();
    return {
      tier: 1, tierLabel: 'Tier 1 — Verified',
      dailyConvertUsedMinor: 1_200_00, dailyConvertLimitMinor: 10_000_00,
      monthlyPayoutUsedMinor: 18_400_00, monthlyPayoutLimitMinor: 50_000_00,
      perTxLimitMinor: 5_000_00, currency: 'USD',
    };
  }
  return unwrap<TierLimits>(await api.get('/api/v1/fx/limits'));
}
