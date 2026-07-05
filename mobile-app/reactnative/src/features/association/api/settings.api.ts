// ── Association — Settings & Support API wrapper (V/W) ────────────────────────

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK, ASSOCIATION_API_BASE as BASE } from '../constants/association.constants';
import type {
  NotificationPrefs, SecuritySettings, Device, Preferences,
  FaqItem, SupportTicket, SupportTicketSummary, TicketMessage, CreateTicketInput,
} from '../types/settings.types';
import {
  MOCK_NOTIF_PREFS, MOCK_SECURITY, MOCK_DEVICES, MOCK_FAQS, MOCK_TICKETS,
} from './settings.mock';

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

// In-memory session state for mock toggles/devices.
let prefs: NotificationPrefs = { ...MOCK_NOTIF_PREFS };
let security: SecuritySettings = { ...MOCK_SECURITY };
let devices: Device[] = [...MOCK_DEVICES];
let preferences: Preferences = { language: 'English', theme: 'SYSTEM' };

export async function getPreferences(): Promise<Preferences> {
  if (USE_MOCK) { await delay(120); return preferences; }
  const { data } = await api.get(`${BASE}/me/preferences`);
  return data;
}
export async function updatePreferences(next: Preferences): Promise<Preferences> {
  if (USE_MOCK) { await delay(150); preferences = { ...next }; return preferences; }
  const { data } = await api.put(`${BASE}/me/preferences`, next);
  return data;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  if (USE_MOCK) { await delay(); return prefs; }
  const { data } = await api.get(`${BASE}/me/notification-prefs`);
  return data;
}
export async function updateNotificationPrefs(next: NotificationPrefs): Promise<NotificationPrefs> {
  if (USE_MOCK) { await delay(150); prefs = { ...next }; return prefs; }
  const { data } = await api.put(`${BASE}/me/notification-prefs`, next);
  return data;
}

export async function getSecuritySettings(): Promise<SecuritySettings> {
  if (USE_MOCK) { await delay(); return security; }
  const { data } = await api.get(`${BASE}/me/security`);
  return data;
}
export async function updateSecuritySettings(next: SecuritySettings): Promise<SecuritySettings> {
  if (USE_MOCK) { await delay(150); security = { ...next }; return security; }
  const { data } = await api.put(`${BASE}/me/security`, next);
  return data;
}

export async function getDevices(): Promise<Device[]> {
  if (USE_MOCK) { await delay(); return devices; }
  const { data } = await api.get(`${BASE}/me/devices`);
  return data;
}
export async function revokeDevice(id: string): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(250); devices = devices.filter((d) => d.id !== id); return { ok: true }; }
  const { data } = await api.delete(`${BASE}/me/devices/${id}`);
  return data;
}

// ─── Support ──────────────────────────────────────────────────────────────────

export async function getFaqs(): Promise<FaqItem[]> {
  if (USE_MOCK) { await delay(); return MOCK_FAQS; }
  const { data } = await api.get(`${BASE}/support/faqs`);
  return data;
}

const toTicketSummary = (t: SupportTicket): SupportTicketSummary => {
  const { id, subject, category, status, updatedAt } = t;
  return { id, subject, category, status, updatedAt };
};

export async function getTickets(): Promise<SupportTicketSummary[]> {
  if (USE_MOCK) { await delay(); return MOCK_TICKETS.map(toTicketSummary); }
  const { data } = await api.get(`${BASE}/support/tickets`);
  return data;
}

export async function getTicket(id: string): Promise<SupportTicket> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_TICKETS.find((t) => t.id === id);
    if (!found) throw new Error('Ticket not found');
    return found;
  }
  const { data } = await api.get(`${BASE}/support/tickets/${id}`);
  return data;
}

export async function createTicket(input: CreateTicketInput): Promise<{ id: string }> {
  if (USE_MOCK) { await delay(400); return { id: `tk_${Date.now()}` }; }
  const { data } = await api.post(`${BASE}/support/tickets`, input, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

export async function replyTicket(id: string, body: string): Promise<TicketMessage> {
  if (USE_MOCK) {
    await delay(160);
    return { id: `local_${Date.now()}`, author: 'You', fromSupport: false, body, createdAt: new Date().toISOString() };
  }
  const { data } = await api.post(`${BASE}/support/tickets/${id}/messages`, { body });
  return data;
}
