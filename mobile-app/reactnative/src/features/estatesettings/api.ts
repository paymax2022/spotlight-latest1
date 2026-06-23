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
  const { data } = await api.get<MemberSettings>(SETTINGS_API_BASE); return data;
}
export async function updateSettings(patch: Partial<MemberSettings>): Promise<MemberSettings> {
  if (USE_MOCK) { await latency(); current = { ...current, ...patch }; return { ...current }; }
  const { data } = await api.patch<MemberSettings>(SETTINGS_API_BASE, patch); return data;
}
