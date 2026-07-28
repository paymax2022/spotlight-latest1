// Estate member settings (Block 45) — types + dual mock/live api.
import { api } from '@/api/client';

export interface MemberSettings {
  pushEnabled: boolean;
  emailEnabled: boolean;
  notifyPayments: boolean;
  notifyMeetings: boolean;
  notifyElections: boolean;
  notifySecurity: boolean;
  notifyMaintenance: boolean;
  notifyAnnouncements: boolean;
  language: string;
}

export const USE_MOCK = (process.env.EXPO_PUBLIC_ESTATESETTINGS_USE_MOCK ?? 'true') !== 'false';
export const SETTINGS_API_BASE = '/api/v1/estate/settings';

export const DEFAULT_SETTINGS: MemberSettings = {
  pushEnabled: true, emailEnabled: true, notifyPayments: true, notifyMeetings: true,
  notifyElections: true, notifySecurity: true, notifyMaintenance: true, notifyAnnouncements: true, language: 'en',
};

export const TOGGLE_FIELDS: { key: keyof MemberSettings; label: string; hint: string }[] = [
  { key: 'pushEnabled',        label: 'Push notifications', hint: 'Receive alerts on this device' },
  { key: 'emailEnabled',       label: 'Email notifications', hint: 'Receive estate emails' },
  { key: 'notifyPayments',     label: 'Payments & dues',    hint: 'Invoice reminders and receipts' },
  { key: 'notifyMeetings',     label: 'Meetings',           hint: 'New meetings and RSVPs' },
  { key: 'notifyElections',    label: 'Elections',          hint: 'Voting opens and results' },
  { key: 'notifySecurity',     label: 'Security',           hint: 'Emergencies and security alerts' },
  { key: 'notifyMaintenance',  label: 'Maintenance',        hint: 'Repair status updates' },
  { key: 'notifyAnnouncements',label: 'Announcements',      hint: 'Estate-wide notices' },
];

let current: MemberSettings = { ...DEFAULT_SETTINGS };
const latency = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export async function getSettings(): Promise<MemberSettings> {
  if (USE_MOCK) { await latency(); return { ...current }; }
  const { data } = await api.get(SETTINGS_API_BASE); return fromApi(data);
}
export async function updateSettings(patch: Partial<MemberSettings>): Promise<MemberSettings> {
  if (USE_MOCK) { await latency(); current = { ...current, ...patch }; return { ...current }; }
  const { data } = await api.patch(SETTINGS_API_BASE, toApi(patch)); return fromApi(data);
}

// The backend uses snake_case keys; map both directions for the notification subset.
function fromApi(r: any): MemberSettings {
  return {
    pushEnabled: !!r.push_enabled,
    emailEnabled: !!r.email_enabled,
    notifyPayments: !!r.notify_payments,
    notifyMeetings: !!r.notify_meetings,
    notifyElections: !!r.notify_elections,
    notifySecurity: !!r.notify_security,
    notifyMaintenance: !!r.notify_maintenance,
    notifyAnnouncements: !!r.notify_announcements,
    language: r.language ?? 'en',
  };
}
function toApi(p: Partial<MemberSettings>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (p.pushEnabled !== undefined) o.push_enabled = p.pushEnabled;
  if (p.emailEnabled !== undefined) o.email_enabled = p.emailEnabled;
  if (p.notifyPayments !== undefined) o.notify_payments = p.notifyPayments;
  if (p.notifyMeetings !== undefined) o.notify_meetings = p.notifyMeetings;
  if (p.notifyElections !== undefined) o.notify_elections = p.notifyElections;
  if (p.notifySecurity !== undefined) o.notify_security = p.notifySecurity;
  if (p.notifyMaintenance !== undefined) o.notify_maintenance = p.notifyMaintenance;
  if (p.notifyAnnouncements !== undefined) o.notify_announcements = p.notifyAnnouncements;
  if (p.language !== undefined) o.language = p.language;
  return o;
}

// Block 45: account soft-delete (anonymises PII; auth handled by Supabase).
export async function deleteAccount(): Promise<void> {
  if (USE_MOCK) { await latency(); return; }
  await api.delete('/api/v1/estate/account');
}
