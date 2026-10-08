// settle on completion) and carries an Idempotency-Key. Callout/distance fares
// come from the SERVER.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import type {
  TowingJob,
  TowingEstimate,
  TowingEstimateRequest,
  TowingBookRequest,
} from '../types/modes.types';
import {
  buildTowingCardDirectBody,
  normalizeTowingStatus,
  towingCardDirectStatusPath,
  TOWING_CARD_DIRECT_BASE,
  type TowingCardDirectInput,
} from '../utils/towingCardDirect';
import type { CardDirectIntent, CardDirectStatus } from '../utils/cardDirect';
import {
  mockTowingEstimate,
  makeTowingJob,
  towingStore,
  advanceMockTowing,
  MOCK_TOWING_HISTORY,
} from './towing.mock';

const USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_TOWING_USE_MOCK ?? process.env.EXPO_PUBLIC_MOBILITY_USE_MOCK, true);

const BASE = '/api/v1';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;
const idemHeader = (key: string) => ({ headers: { 'Idempotency-Key': key } });

export async function estimateTowing(req: TowingEstimateRequest): Promise<TowingEstimate> {
  if (USE_MOCK) {
    await delay(420);
    return mockTowingEstimate(req);
  }
  return unwrap<TowingEstimate>(
    await api.post(`${BASE}/mobility/towing/estimate`, {
      service_type: req.serviceType,
      issue: req.issue,
      pickup: req.pickup,
      dest: req.dest,
      vehicle_type: req.vehicleType,
    }),
  );
}

export async function bookTowing(req: TowingBookRequest): Promise<TowingJob> {
  if (USE_MOCK) {
    await delay(900);
    const est = mockTowingEstimate(req);
    const job = makeTowingJob({
      serviceType: req.serviceType,
      issue: req.issue,
      vehicleType: req.vehicleType,
      pickup: req.pickup,
      dest: req.dest,
      fareKobo: est.totalKobo,
      photoUrl: req.photoUrl ?? null,
      phase: 'requested',
    });
    towingStore.active = job;
    return job;
  }
  return unwrap<TowingJob>(
    await api.post(
      `${BASE}/mobility/towing`,
      {
        service_type: req.serviceType,
        issue: req.issue,
        pickup: req.pickup,
        dest: req.dest,
        vehicle_type: req.vehicleType,
        photo_url: req.photoUrl,
        payment_method: req.paymentMethod,
      },
      idemHeader(req.idempotencyKey),
    ),
  );
}

// ── Card-direct (pay by debit card, never the wallet KYC-tier gate) ─────────
// backend/internal/transport/paystackcheckout (towing domain). Same pattern as
// the parcel domain in parcel.api.ts: the server quotes + freezes the amount,
// Paystack collects it, the server verifies and books. The wallet rail
// (bookTowing) keeps its KYC gate unchanged.

export type TowingCardDirectIntent = CardDirectIntent;
export type TowingCardDirectStatus = CardDirectStatus & { towingJobId?: string };

export async function initiateTowingPaystack(
  req: TowingCardDirectInput & { idempotencyKey: string },
): Promise<TowingCardDirectIntent> {
  if (USE_MOCK) {
    await delay(600);
    return {
      reference: `towingorder:${req.idempotencyKey}`,
      authorizationUrl: `https://paystack.test/mock/${req.idempotencyKey}`,
      amountKobo: 0,
      status: 'pending',
    };
  }
  return unwrap<TowingCardDirectIntent>(
    await api.post(
      `${BASE}${TOWING_CARD_DIRECT_BASE}/initiate`,
      buildTowingCardDirectBody(req),
      idemHeader(req.idempotencyKey),
    ),
  );
}

export async function getTowingPaystackStatus(reference: string): Promise<TowingCardDirectStatus> {
  if (USE_MOCK) {
    await delay(400);
    return { reference, status: 'confirmed', amountKobo: 0, towingJobId: towingStore.active?.id ?? 'mock-towing-1' };
  }
  return normalizeTowingStatus(
    unwrap<{ reference: string; status: CardDirectStatus['status']; amountKobo?: number; towingJobId?: string }>(
      await api.get(`${BASE}${towingCardDirectStatusPath(reference)}`),
    ),
  );
}

export async function getTowingJob(id: string): Promise<TowingJob> {
  if (USE_MOCK) {
    await delay(260);
    if (towingStore.active?.id === id) return advanceMockTowing(towingStore.active);
    const found = MOCK_TOWING_HISTORY.find((j) => j.id === id);
    if (!found) throw new Error('Towing job not found');
    return found;
  }
  return unwrap<TowingJob>(await api.get(`${BASE}/mobility/towing/${id}`));
}

export async function cancelTowing(id: string): Promise<TowingJob> {
  if (USE_MOCK) {
    await delay(500);
    const j = towingStore.active;
    if (j) {
      j.phase = 'cancelled';
      j.paymentStatus = 'refunded';
      towingStore.active = null;
    }
    return j ?? makeTowingJob({ phase: 'cancelled', paymentStatus: 'refunded' });
  }
  return unwrap<TowingJob>(await api.post(`${BASE}/mobility/towing/${id}/cancel`, {}));
}

export async function rateTowing(
  id: string,
  stars: number,
  idempotencyKey: string,
  comment?: string,
  tipKobo?: number,
): Promise<void> {
  if (USE_MOCK) {
    await delay(500);
    if (towingStore.active?.id === id) towingStore.active.rated = true;
    const h = MOCK_TOWING_HISTORY.find((j) => j.id === id);
    if (h) h.rated = true;
    return;
  }
  await api.post(
    `${BASE}/mobility/towing/${id}/rate`,
    { stars, comment, tip_kobo: tipKobo },
    idemHeader(idempotencyKey),
  );
}

export function clearMockActiveTowing(): void {
  if (USE_MOCK) towingStore.active = null;
}

export { USE_MOCK };
