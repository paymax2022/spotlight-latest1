// completion confirmation. Bid amounts come from providers via the SERVER.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import type { MoverJob, MoverQuoteRequest } from '../types/modes.types';
import type { CardDirectIntent, CardDirectStatus } from '../utils/cardDirect';
import {
  buildMoversCardDirectBody,
  moversCardDirectStatusPath,
  MOVERS_CARD_DIRECT_BASE,
  normalizeMoversStatus,
  type MoversCardDirectInput,
} from '../utils/moversCardDirect';
import {
  makeMoverJob,
  moverStore,
  advanceMockMover,
  MOCK_MOVER_HISTORY,
} from './movers.mock';

const USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_MOVERS_USE_MOCK ?? process.env.EXPO_PUBLIC_MOBILITY_USE_MOCK, true);

const BASE = '/api/v1';
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

// ── Card-direct (pay the accepted bid by debit card, never the wallet KYC gate) ──
// backend/internal/transport/paystackcheckout (movers domain). Charged at BID
// ACCEPTANCE: the server reads the bid's amount itself (this request carries only
// job_id + bid_id), Paystack collects it, the server re-checks the job/bid and
// escrows it. If the bid was withdrawn/changed or the move is no longer open when
// the charge confirms, the charge is refunded. The wallet rail (acceptBid) keeps
// its KYC gate unchanged.

export type MoverCardDirectIntent = CardDirectIntent;
export type MoverCardDirectStatus = CardDirectStatus & { moveId?: string };

export async function initiateMoverPaystack(
  req: MoversCardDirectInput & { idempotencyKey: string },
): Promise<MoverCardDirectIntent> {
  if (USE_MOCK) {
    await delay(600);
    const bid = moverStore.active?.bids.find((b) => b.id === req.bidId);
    return {
      reference: `moversorder:${req.idempotencyKey}`,
      authorizationUrl: `https://paystack.test/mock/${req.idempotencyKey}`,
      amountKobo: bid?.amountKobo ?? 0,
      status: 'pending',
    };
  }
  return unwrap<MoverCardDirectIntent>(
    await api.post(
      `${BASE}${MOVERS_CARD_DIRECT_BASE}/initiate`,
      buildMoversCardDirectBody(req),
      idemHeader(req.idempotencyKey),
    ),
  );
}

export async function getMoverPaystackStatus(reference: string): Promise<MoverCardDirectStatus> {
  if (USE_MOCK) {
    await delay(400);
    const j = moverStore.active;
    if (j) {
      // The mock "charge" funds the first bid the way the wallet mock does.
      const bid = j.acceptedBid ?? j.bids[0] ?? null;
      j.acceptedBid = bid ? { ...bid, createdAt: new Date().toISOString() } : null;
      j.fareKobo = bid?.amountKobo ?? null;
      j.phase = 'bid_accepted';
      j.paymentStatus = 'escrowed';
    }
    return { reference, status: 'confirmed', amountKobo: j?.fareKobo ?? 0, moveId: j?.id ?? 'mock-move-1' };
  }
  return normalizeMoversStatus(
    unwrap<{ reference: string; status: CardDirectStatus['status']; amountKobo?: number; moveId?: string }>(
      await api.get(`${BASE}${moversCardDirectStatusPath(reference)}`),
    ),
  );
}

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

export async function rateMover(
  id: string,
  stars: number,
  idempotencyKey: string,
  comment?: string,
  tipKobo?: number,
): Promise<void> {
  if (USE_MOCK) {
    await delay(500);
    if (moverStore.active?.id === id) moverStore.active.rated = true;
    const h = MOCK_MOVER_HISTORY.find((j) => j.id === id);
    if (h) h.rated = true;
    return;
  }
  await api.post(
    `${BASE}/mobility/movers/${id}/rate`,
    { stars, comment, tip_kobo: tipKobo },
    idemHeader(idempotencyKey),
  );
}

export function clearMockActiveMover(): void {
  if (USE_MOCK) moverStore.active = null;
}

export { USE_MOCK };
