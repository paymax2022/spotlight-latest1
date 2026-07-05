// ── Property Management — API surface ────────────────────────────────────────
// Two paths behind one signature:
//   • USE_MOCK === true  → in-memory mock (mock.ts) with simulated latency
//   • USE_MOCK === false → real HTTP against the canonical Go backend paths
//                          (/api/finance/property/* + /api/finance/realtor/*)
// Flip EXPO_PUBLIC_PROPERTY_USE_MOCK=false to go live. Mirrors the visitor/
// realtor mock-flag convention.

import { api } from '@/api/client';
import type {
  ActiveContextRef,
  ContextEnvelope,
  RentPassport,
  StayGatePass,
  SwitchContextInput,
} from './types';
import {
  mockContextEnvelope,
  mockGatePass,
  MOCK_RENT_PASSPORT,
} from './mock';

export const USE_MOCK =
  (process.env.EXPO_PUBLIC_PROPERTY_USE_MOCK ?? 'true') !== 'false';

const wait = (ms = 280) => new Promise<void>((r) => setTimeout(r, ms));

// Active context held in-memory for the mock path so a switch sticks for the session.
let mockActiveType: ActiveContextRef | null = mockContextEnvelope().activeContext;

// ── GET /api/finance/property/context ─────────────────────────────────────────
export async function getContext(): Promise<ContextEnvelope> {
  if (USE_MOCK) {
    await wait();
    return { ...mockContextEnvelope(), activeContext: mockActiveType };
  }
  const res = await api.get('/api/finance/property/context');
  return (res.data?.data ?? res.data) as ContextEnvelope;
}

// ── POST /api/finance/property/context/switch ────────────────────────────────
export async function switchContext(input: SwitchContextInput): Promise<ContextEnvelope> {
  if (USE_MOCK) {
    await wait();
    mockActiveType = { type: input.contextType, id: input.contextId };
    return { ...mockContextEnvelope(), activeContext: mockActiveType };
  }
  const res = await api.post('/api/finance/property/context/switch', {
    contextType: input.contextType,
    contextId:   input.contextId,
  });
  return (res.data?.data ?? res.data) as ContextEnvelope;
}

// ── GET /api/finance/property/rent-passport/me ───────────────────────────────
export async function getRentPassport(): Promise<RentPassport> {
  if (USE_MOCK) {
    await wait();
    return MOCK_RENT_PASSPORT;
  }
  const res = await api.get('/api/finance/property/rent-passport/me');
  return (res.data?.data ?? res.data) as RentPassport;
}

// ── GET /api/finance/realtor/stays/:bookingId/gate-pass ──────────────────────
// Returns null when no pass has been auto-issued (live path: 404 → null).
export async function getStayGatePass(bookingId: string): Promise<StayGatePass | null> {
  if (USE_MOCK) {
    await wait();
    return mockGatePass(bookingId);
  }
  try {
    const res = await api.get(`/api/finance/realtor/stays/${bookingId}/gate-pass`);
    return (res.data?.data ?? res.data) as StayGatePass;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw err;
  }
}
