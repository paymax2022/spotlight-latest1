// ── Business Logistics — API wrapper ─────────────────────────────────────────
// Typed data layer the business-logistics screens code against. Mirrors
// parcel.api.ts: mock-flagged, BASE = '/api/v1', Idempotency-Key on money
// mutations. Flip EXPO_PUBLIC_MOBILITY_USE_MOCK=false (or
// EXPO_PUBLIC_LOGISTICS_USE_MOCK) once the Go endpoints land.
//
// IRON RULES: all money is integer kobo; create/batch carry an Idempotency-Key;
// fares/COD/invoices come from the SERVER — never computed here.

import { api } from '@/api/client';
import type {
  BusinessAccount,
  AccountCreateRequest,
  Delivery,
  DeliveryStatus,
  DeliveryCreateRequest,
  Batch,
  BatchDetail,
  BatchCreateRequest,
  BusinessInvoice,
  BusinessAnalytics,
} from '../types/logistics.types';
import {
  logisticsStore,
  ensureSeed,
  mockBusinessAccount,
  makeBusinessAccount,
  makeDeliveryFromRequest,
  makeBatchFromRequest,
  mockInvoices,
  mockAnalytics,
} from './logistics.mock';

const USE_MOCK =
  (process.env.EXPO_PUBLIC_LOGISTICS_USE_MOCK ?? process.env.EXPO_PUBLIC_MOBILITY_USE_MOCK ?? 'true').toLowerCase() !== 'false';

const BASE = '/api/v1';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;
const idemHeader = (key: string) => ({ headers: { 'Idempotency-Key': key } });

// ═══════════════════════════════════════════════════════════════════════════════
// BUSINESS ACCOUNT
// ═══════════════════════════════════════════════════════════════════════════════
export async function getMyBusinessAccount(): Promise<BusinessAccount | null> {
  if (USE_MOCK) {
    await delay(300);
    return mockBusinessAccount();
  }
  return unwrap<BusinessAccount | null>(await api.get(`${BASE}/mobility/business/accounts/me`));
}

export async function createBusinessAccount(req: AccountCreateRequest): Promise<BusinessAccount> {
  if (USE_MOCK) {
    await delay(700);
    return makeBusinessAccount(req);
  }
  return unwrap<BusinessAccount>(
    await api.post(`${BASE}/mobility/business/accounts`, {
      name: req.name,
      account_type: req.accountType,
      billing_mode: req.billingMode,
      cod_enabled: req.codEnabled,
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DELIVERY
// ═══════════════════════════════════════════════════════════════════════════════
// ─── Create (money mutation → escrow/accrue → Idempotency-Key) ─────────────────
export async function createDelivery(req: DeliveryCreateRequest): Promise<Delivery> {
  if (USE_MOCK) {
    await delay(900);
    ensureSeed();
    const delivery = makeDeliveryFromRequest(req);
    logisticsStore.deliveries.unshift(delivery);
    return delivery;
  }
  return unwrap<Delivery>(
    await api.post(
      `${BASE}/mobility/business/deliveries`,
      {
        pickup: req.pickup,
        dropoff: req.dropoff,
        receiver_name: req.receiverName,
        receiver_phone: req.receiverPhone,
        size: req.size,
        cod_kobo: req.codKobo,
      },
      idemHeader(req.idempotencyKey),
    ),
  );
}

export async function getDeliveries(status?: DeliveryStatus): Promise<Delivery[]> {
  if (USE_MOCK) {
    await delay();
    ensureSeed();
    const list = [...logisticsStore.deliveries].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return status ? list.filter((d) => d.status === status) : list;
  }
  return unwrap<Delivery[]>(await api.get(`${BASE}/mobility/business/deliveries`, { params: status ? { status } : undefined }));
}

export async function getDelivery(id: string): Promise<Delivery> {
  if (USE_MOCK) {
    await delay(260);
    ensureSeed();
    const found =
      logisticsStore.deliveries.find((d) => d.id === id) ??
      logisticsStore.batches.flatMap((b) => b.deliveries).find((d) => d.id === id);
    if (!found) throw new Error('Delivery not found');
    return found;
  }
  return unwrap<Delivery>(await api.get(`${BASE}/mobility/business/deliveries/${id}`));
}

export async function cancelDelivery(id: string): Promise<Delivery> {
  if (USE_MOCK) {
    await delay(500);
    ensureSeed();
    const d = logisticsStore.deliveries.find((x) => x.id === id);
    if (d) {
      d.status = 'cancelled';
      d.dropoffPin = null;
    }
    if (!d) throw new Error('Delivery not found');
    return d;
  }
  return unwrap<Delivery>(await api.post(`${BASE}/mobility/business/deliveries/${id}/cancel`, {}));
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH (bulk dispatch)
// ═══════════════════════════════════════════════════════════════════════════════
// ─── Create (money mutation → escrow/accrue → Idempotency-Key) ─────────────────
export async function createBatch(req: BatchCreateRequest): Promise<BatchDetail> {
  if (USE_MOCK) {
    await delay(1000);
    ensureSeed();
    const batch = makeBatchFromRequest(req);
    logisticsStore.batches.unshift(batch);
    return batch;
  }
  return unwrap<BatchDetail>(
    await api.post(
      `${BASE}/mobility/business/batches`,
      {
        name: req.name,
        deliveries: req.deliveries.map((d) => ({
          pickup: d.pickup,
          dropoff: d.dropoff,
          receiver_name: d.receiverName,
          receiver_phone: d.receiverPhone,
          size: d.size,
          cod_kobo: d.codKobo,
        })),
      },
      idemHeader(req.idempotencyKey),
    ),
  );
}

export async function getBatches(): Promise<Batch[]> {
  if (USE_MOCK) {
    await delay();
    ensureSeed();
    return [...logisticsStore.batches]
      .map(({ deliveries: _deliveries, ...rest }) => rest)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return unwrap<Batch[]>(await api.get(`${BASE}/mobility/business/batches`));
}

export async function getBatch(id: string): Promise<BatchDetail> {
  if (USE_MOCK) {
    await delay(280);
    ensureSeed();
    const found = logisticsStore.batches.find((b) => b.id === id);
    if (!found) throw new Error('Batch not found');
    return found;
  }
  return unwrap<BatchDetail>(await api.get(`${BASE}/mobility/business/batches/${id}`));
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVOICES + ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════
export async function getInvoices(): Promise<BusinessInvoice[]> {
  if (USE_MOCK) {
    await delay(380);
    return mockInvoices();
  }
  return unwrap<BusinessInvoice[]>(await api.get(`${BASE}/mobility/business/invoices`));
}

export async function getAnalytics(): Promise<BusinessAnalytics> {
  if (USE_MOCK) {
    await delay(360);
    return mockAnalytics();
  }
  return unwrap<BusinessAnalytics>(await api.get(`${BASE}/mobility/business/analytics`));
}

export { USE_MOCK };
