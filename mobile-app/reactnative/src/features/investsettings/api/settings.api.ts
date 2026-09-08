// ── Paymax Invest · Settings — API wrapper ───────────────────────────────────
// Typed data layer the invest-settings screens code against (Backend role owns
// this file). Mirrors crypto.api.ts: mock-flagged behind EXPO_PUBLIC_SETTINGS_USE_MOCK.
// Flip to false once the real Paymax /api/v1/* endpoints land.
//
// Conventions honoured here:
//  • account numbers are never stored in full client-side — banks expose a mask;
//  • PIN changes never echo the PIN back; the server validates the old PIN;
//  • support threads are append-only from the client's perspective.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import {
  MOCK_BANKS,
  MOCK_DEVICES,
  MOCK_PROFILE,
  MOCK_STATEMENTS,
  MOCK_TICKETS,
} from './settings.mock';
import type {
  Device,
  InvestProfile,
  LinkedBank,
  NewBankDraft,
  NewTicketDraft,
  Statement,
  StatementExport,
  SupportTicket,
} from '../types/settings.types';
import { FEE_SCHEDULE } from '../constants/settings.constants';
import type { FeeScheduleItem } from '../types/settings.types';

// ─── Feature flag: flip to false once real endpoints are ready ────────────────
const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_SETTINGS_USE_MOCK, true);

/** Simulated network latency so loading states render in mock mode. */
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

/** Normalise a thrown axios error into an Error carrying the backend's message. */
function toSettingsError(err: unknown): Error {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  const msg = e?.response?.data?.message ?? e?.message ?? 'Something went wrong. Please try again.';
  return new Error(msg);
}

// ─── Profile (GET /api/v1/invest/profile) ─────────────────────────────────────

export async function getProfile(): Promise<InvestProfile> {
  if (USE_MOCK) { await delay(220); return { ...MOCK_PROFILE }; }
  return unwrap<InvestProfile>(await api.get('/api/v1/invest/profile'));
}

// ─── Linked banks (GET/POST/DELETE /api/v1/invest/banks) ──────────────────────

export async function getLinkedBanks(): Promise<LinkedBank[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_BANKS]; }
  return unwrap<LinkedBank[]>(await api.get('/api/v1/invest/banks'));
}

export async function addBank(draft: NewBankDraft): Promise<LinkedBank> {
  if (USE_MOCK) {
    await delay(520);
    const last4 = draft.accountNumber.replace(/\D/g, '').slice(-4).padStart(4, '0');
    const created: LinkedBank = {
      id: `bank_${Date.now()}`,
      bankName: draft.bankName,
      accountMasked: `•••• ${last4}`,
      primary: MOCK_BANKS.length === 0,
    };
    MOCK_BANKS.push(created);
    return created;
  }
  try {
    return unwrap<LinkedBank>(await api.post('/api/v1/invest/banks', draft));
  } catch (err) {
    throw toSettingsError(err);
  }
}

export async function removeBank(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(260);
    const i = MOCK_BANKS.findIndex((b) => b.id === id);
    if (i >= 0) {
      const [removed] = MOCK_BANKS.splice(i, 1);
      // Promote another account to primary if we removed the primary one.
      if (removed.primary && MOCK_BANKS.length > 0) MOCK_BANKS[0].primary = true;
    }
    return;
  }
  await api.delete(`/api/v1/invest/banks/${id}`);
}

// ─── Fee schedule (GET /api/v1/invest/fees) ───────────────────────────────────

export async function getFeeSchedule(): Promise<FeeScheduleItem[]> {
  if (USE_MOCK) { await delay(180); return [...FEE_SCHEDULE]; }
  return unwrap<FeeScheduleItem[]>(await api.get('/api/v1/invest/fees'));
}

// ─── Statements (GET /api/v1/invest/statements, POST …/export) ────────────────

export async function getStatements(): Promise<Statement[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_STATEMENTS].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return unwrap<Statement[]>(await api.get('/api/v1/invest/statements'));
}

export async function exportStatement(id: string): Promise<StatementExport> {
  if (USE_MOCK) {
    await delay(700);
    return {
      id,
      url: `https://mock.paymax.invest/statements/${id}.pdf`,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
  }
  try {
    return unwrap<StatementExport>(await api.post(`/api/v1/invest/statements/${id}/export`, {}));
  } catch (err) {
    throw toSettingsError(err);
  }
}

// ─── Devices / sessions (GET /api/v1/invest/devices, DELETE …/:id) ────────────

export async function getDevices(): Promise<Device[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_DEVICES].sort((a, b) => +new Date(b.lastActive) - +new Date(a.lastActive));
  }
  return unwrap<Device[]>(await api.get('/api/v1/invest/devices'));
}

export async function revokeDevice(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(300);
    const i = MOCK_DEVICES.findIndex((d) => d.id === id);
    if (i >= 0 && !MOCK_DEVICES[i].current) MOCK_DEVICES.splice(i, 1);
    return;
  }
  await api.delete(`/api/v1/invest/devices/${id}`);
}

// ─── Security · change PIN (POST /api/v1/invest/security/pin) ─────────────────

export async function changePin(oldPin: string, newPin: string): Promise<void> {
  if (USE_MOCK) {
    await delay(640);
    // Mock validation so the error path is reachable: the seeded PIN is 0000.
    if (oldPin !== '0000') throw new Error('Your current PIN is incorrect.');
    if (newPin.length !== 4) throw new Error('Your new PIN must be 4 digits.');
    return;
  }
  try {
    await api.post('/api/v1/invest/security/pin', { old_pin: oldPin, new_pin: newPin });
  } catch (err) {
    throw toSettingsError(err);
  }
}

// ─── Support tickets (GET/POST /api/v1/invest/support/tickets[/:id]) ──────────

export async function getTickets(): Promise<SupportTicket[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_TICKETS].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return unwrap<SupportTicket[]>(await api.get('/api/v1/invest/support/tickets'));
}

export async function getTicket(id: string): Promise<SupportTicket> {
  if (USE_MOCK) {
    await delay(220);
    const found = MOCK_TICKETS.find((t) => t.id === id);
    if (!found) throw new Error('Ticket not found');
    return found;
  }
  return unwrap<SupportTicket>(await api.get(`/api/v1/invest/support/tickets/${id}`));
}

export async function createTicket(draft: NewTicketDraft): Promise<SupportTicket> {
  if (USE_MOCK) {
    await delay(560);
    const now = new Date().toISOString();
    const created: SupportTicket = {
      id: `tkt_${Date.now()}`,
      subject: draft.subject,
      status: 'open',
      createdAt: now,
      messages: [{ from: 'user', body: draft.body, at: now }],
    };
    MOCK_TICKETS.unshift(created);
    return created;
  }
  try {
    return unwrap<SupportTicket>(await api.post('/api/v1/invest/support/tickets', draft));
  } catch (err) {
    throw toSettingsError(err);
  }
}
