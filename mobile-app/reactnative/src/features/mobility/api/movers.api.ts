// ── Movers — API wrapper ─────────────────────────────────────────────────────
// Mock-flagged, BASE = '/api/finance'. Accepting a bid is a money mutation
// (escrow fund) and carries an Idempotency-Key; escrow releases only on
// completion confirmation. Bid amounts come from providers via the SERVER.

import { api } from '@/api/client';
import type { MoverJob, MoverQuoteRequest } from '../types/modes.types';
import {
  makeMoverJob,
  moverStore,
  advanceMockMover,
  MOCK_MOVER_HISTORY,
} from './movers.mock';

const USE_MOCK =
  (process.env.EXPO_PUBLIC_MOVERS_USE_MOCK ?? process.env.EXPO_PUBLIC_MOBILITY_USE_MOCK ?? 'true').toLowerCase() !== 'false';

const BASE = '/api/finance';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;
const idemHeader = (key: string) => ({ headers: { 'Idempotency-Key': key } });

export async function requestQuote(req: MoverQuoteRequest): Promise<MoverJob> {
  if (USE_MOCK) {
    await delay(800);
    const job = makeMoverJob(req);
    moverStore.active = job;
    return job;
  }
  return unwrap<MoverJob>(
    await api.post(`${BASE}/mobility/movers/quote`, {
      pickup: req.pickup,
      dropoff: req.dropoff,
      truck_size: req.truckSize,
      helpers: req.helpers,
      inventory: req.inventory,
      move_at: req.moveAt,
    }),
  );
}

export async function getMoverJob(id: string): Promise<MoverJob> {
  if (USE_MOCK) {
    await delay(300);
    if (moverStore.active?.id === id) return advanceMockMover(moverStore.active);
    const found = MOCK_MOVER_HISTORY.find((j) => j.id === id);
    if (!found) throw new Error('Move not found');
    return found;
  }
  return unwrap<MoverJob>(await api.get(`${BASE}/mobility/movers/${id}`));
}

export async function getMoverJobs(): Promise<MoverJob[]> {
  if (USE_MOCK) {
    await delay();
    const list = [...MOCK_MOVER_HISTORY];
    if (moverStore.active) list.unshift(advanceMockMover(moverStore.active));
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return unwrap<MoverJob[]>(await api.get(`${BASE}/mobility/movers`));
}

// ─── Accept bid (money mutation → escrow fund → Idempotency-Key) ───────────────
export async function acceptBid(id: string, bidId: string, idempotencyKey: string): Promise<MoverJob> {
  if (USE_MOCK) {
    await delay(800);
    const j = moverStore.active;
    if (j) {
      const bid = j.bids.find((b) => b.id === bidId) ?? null;
      j.acceptedBid = bid ? { ...bid, createdAt: new Date().toISOString() } : null;
      j.fareKobo = bid?.amountKobo ?? null;
      j.phase = 'bid_accepted';
      j.paymentStatus = 'escrowed';
    }
    return j!;
  }
  return unwrap<MoverJob>(
    await api.post(`${BASE}/mobility/movers/${id}/accept-bid`, { bid_id: bidId }, idemHeader(idempotencyKey)),
  );
}

// ─── Confirm completion (release escrow → settle provider; Idempotency-Key) ────
export async function confirmCompletion(id: string, idempotencyKey: string): Promise<MoverJob> {
  if (USE_MOCK) {
    await delay(700);
    const j = moverStore.active;
    if (j) {
      j.phase = 'completion_confirmed';
      j.paymentStatus = 'settled';
      j.completedAt = new Date().toISOString();
    }
    return j!;
  }
  return unwrap<MoverJob>(
    await api.post(`${BASE}/mobility/movers/${id}/confirm-completion`, {}, idemHeader(idempotencyKey)),
  );
}

export async function rateMover(id: string, stars: number, comment?: string): Promise<void> {
  if (USE_MOCK) {
    await delay(500);
    if (moverStore.active?.id === id) moverStore.active.rated = true;
    const h = MOCK_MOVER_HISTORY.find((j) => j.id === id);
    if (h) h.rated = true;
    return;
  }
  await api.post(`${BASE}/mobility/movers/${id}/rate`, { stars, comment });
}

export function clearMockActiveMover(): void {
  if (USE_MOCK) moverStore.active = null;
}

export { USE_MOCK };
