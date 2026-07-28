// ── Business Logistics — mock seed data + deterministic engine ───────────────
// All money is integer kobo. The "pricing engine" mimics the SERVER: the client
// only ever reads the values it returns, never recomputes fares.

import type {
  BusinessAccount,
  AccountCreateRequest,
  Delivery,
  DeliverySize,
  DeliveryCreateRequest,
  Batch,
  BatchDetail,
  BatchCreateRequest,
  BusinessInvoice,
  BusinessAnalytics,
  Place,
} from '../types/logistics.types';

const now = () => Date.now();
const iso = (msAgo = 0) => new Date(now() - msAgo).toISOString();
const pin = () => String(1000 + Math.floor(Math.random() * 9000));

const SIZE_MULT: Record<DeliverySize, number> = { small: 1, medium: 1.5, large: 2.4 };

const DEFAULT_PICKUP: Place = { address: '14 Admiralty Way, Lekki Phase 1', lat: 6.4459, lng: 3.473 };
const DEFAULT_DROPOFF: Place = { address: 'Ikeja City Mall, Alausa', lat: 6.6186, lng: 3.3585 };

/** Deterministic delivery fare engine — stands in for the server fare engine. */
export function mockDeliveryFare(size: DeliverySize): number {
  const base = 800_00; // ₦800 base
  return Math.round(base * SIZE_MULT[size]);
}

// ─── Account ────────────────────────────────────────────────────────────────
export const logisticsStore: {
  account: BusinessAccount | null;
  deliveries: Delivery[];
  batches: BatchDetail[];
} = { account: null, deliveries: [], batches: [] };

function defaultAccount(): BusinessAccount {
  return {
    id: 'biz_1',
    name: 'Eze Supplies Ltd',
    accountType: 'merchant',
    billingMode: 'prepaid',
    codEnabled: true,
    walletBalanceKobo: 145_000_00,
    currency: 'NGN',
    createdAt: iso(86_400_000 * 40),
  };
}

export function mockBusinessAccount(): BusinessAccount {
  if (!logisticsStore.account) logisticsStore.account = defaultAccount();
  return logisticsStore.account;
}

export function makeBusinessAccount(req: AccountCreateRequest): BusinessAccount {
  const account: BusinessAccount = {
    id: `biz_${now()}`,
    name: req.name,
    accountType: req.accountType,
    billingMode: req.billingMode,
    codEnabled: req.codEnabled,
    walletBalanceKobo: req.billingMode === 'prepaid' ? 0 : 0,
    currency: 'NGN',
    createdAt: iso(),
  };
  logisticsStore.account = account;
  return account;
}

// ─── Delivery ─────────────────────────────────────────────────────────────────
export function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  const size: DeliverySize = overrides.size ?? 'small';
  return {
    id: `dlv_${now()}_${Math.random().toString(36).slice(2, 6)}`,
    status: 'created',
    pickup: DEFAULT_PICKUP,
    dropoff: DEFAULT_DROPOFF,
    receiverName: 'Chioma Eze',
    receiverPhone: '+2348030000010',
    size,
    fareKobo: mockDeliveryFare(size),
    codKobo: 0,
    currency: 'NGN',
    courierName: null,
    proofUrl: null,
    dropoffPin: pin(),
    failureReason: null,
    batchId: null,
    createdAt: iso(),
    deliveredAt: null,
    ...overrides,
  };
}

function seedDeliveries(): Delivery[] {
  return [
    makeDelivery({
      id: 'dlv_s1', status: 'delivered', size: 'medium', receiverName: 'Bola Ahmed',
      receiverPhone: '+2348030000021', codKobo: 25_000_00, courierName: 'Bashir Lawal',
      proofUrl: 'mock://proof/d1', dropoffPin: null,
      dropoff: { address: 'Yaba, Lagos', lat: 6.5095, lng: 3.3711 },
      createdAt: iso(86_400_000 * 2), deliveredAt: iso(86_400_000 * 2 - 5_400_000),
    }),
    makeDelivery({
      id: 'dlv_s2', status: 'picked_up', size: 'small', receiverName: 'Ngozi Obi',
      receiverPhone: '+2348030000022', courierName: 'Aisha Bello',
      dropoff: { address: 'Surulere, Lagos', lat: 6.5005, lng: 3.3487 },
      createdAt: iso(3_600_000 * 3),
    }),
    makeDelivery({
      id: 'dlv_s3', status: 'assigned', size: 'large', receiverName: 'Femi Adeyemi',
      receiverPhone: '+2348030000023', codKobo: 60_000_00, courierName: 'Tunde Cole',
      dropoff: { address: 'Victoria Island, Lagos', lat: 6.4281, lng: 3.4216 },
      createdAt: iso(3_600_000),
    }),
    makeDelivery({
      id: 'dlv_s4', status: 'failed', size: 'small', receiverName: 'Sade Williams',
      receiverPhone: '+2348030000024', failureReason: 'Receiver unreachable after 3 attempts',
      courierName: 'Bashir Lawal', dropoffPin: null,
      dropoff: { address: 'Ajah, Lagos', lat: 6.4698, lng: 3.5852 },
      createdAt: iso(86_400_000), deliveredAt: null,
    }),
  ];
}

function seedBatches(): BatchDetail[] {
  const b1Deliveries: Delivery[] = [
    makeDelivery({ id: 'dlv_b1a', status: 'delivered', size: 'small', batchId: 'bch_s1', courierName: 'Aisha Bello', proofUrl: 'mock://proof/b1a', dropoffPin: null, receiverName: 'Customer A', dropoff: { address: 'Ikeja GRA', lat: 6.585, lng: 3.351 }, createdAt: iso(86_400_000) }),
    makeDelivery({ id: 'dlv_b1b', status: 'delivered', size: 'medium', batchId: 'bch_s1', courierName: 'Aisha Bello', proofUrl: 'mock://proof/b1b', dropoffPin: null, receiverName: 'Customer B', dropoff: { address: 'Maryland, Lagos', lat: 6.572, lng: 3.366 }, createdAt: iso(86_400_000) }),
    makeDelivery({ id: 'dlv_b1c', status: 'failed', size: 'small', batchId: 'bch_s1', failureReason: 'Wrong address', receiverName: 'Customer C', dropoff: { address: 'Ojota, Lagos', lat: 6.583, lng: 3.382 }, createdAt: iso(86_400_000) }),
  ];
  const b1Total = b1Deliveries.reduce((s, d) => s + d.fareKobo, 0);
  const b2Deliveries: Delivery[] = [
    makeDelivery({ id: 'dlv_b2a', status: 'picked_up', batchId: 'bch_s2', courierName: 'Tunde Cole', receiverName: 'Customer D', dropoff: { address: 'Lekki Phase 2', lat: 6.448, lng: 3.512 }, createdAt: iso(3_600_000 * 2) }),
    makeDelivery({ id: 'dlv_b2b', status: 'assigned', batchId: 'bch_s2', courierName: 'Tunde Cole', receiverName: 'Customer E', dropoff: { address: 'Ikate, Lekki', lat: 6.436, lng: 3.481 }, createdAt: iso(3_600_000 * 2) }),
  ];
  const b2Total = b2Deliveries.reduce((s, d) => s + d.fareKobo, 0);
  return [
    {
      id: 'bch_s1', name: 'Tuesday morning run', status: 'partially_failed',
      stopCount: b1Deliveries.length, completedCount: 2, failedCount: 1,
      totalFareKobo: b1Total, currency: 'NGN', createdAt: iso(86_400_000),
      deliveries: b1Deliveries,
    },
    {
      id: 'bch_s2', name: 'Lekki express batch', status: 'in_progress',
      stopCount: b2Deliveries.length, completedCount: 0, failedCount: 0,
      totalFareKobo: b2Total, currency: 'NGN', createdAt: iso(3_600_000 * 2),
      deliveries: b2Deliveries,
    },
  ];
}

export function ensureSeed(): void {
  mockBusinessAccount();
  if (logisticsStore.deliveries.length === 0) logisticsStore.deliveries = seedDeliveries();
  if (logisticsStore.batches.length === 0) logisticsStore.batches = seedBatches();
}

export function makeDeliveryFromRequest(req: DeliveryCreateRequest, batchId: string | null = null): Delivery {
  return makeDelivery({
    pickup: req.pickup,
    dropoff: req.dropoff,
    receiverName: req.receiverName,
    receiverPhone: req.receiverPhone,
    size: req.size,
    codKobo: req.codKobo,
    fareKobo: mockDeliveryFare(req.size),
    status: 'created',
    batchId,
  });
}

export function makeBatchFromRequest(req: BatchCreateRequest): BatchDetail {
  const batchId = `bch_${now()}`;
  const deliveries = req.deliveries.map((d) => makeDeliveryFromRequest(d, batchId));
  const totalFareKobo = deliveries.reduce((s, d) => s + d.fareKobo, 0);
  return {
    id: batchId,
    name: req.name,
    status: 'created',
    stopCount: deliveries.length,
    completedCount: 0,
    failedCount: 0,
    totalFareKobo,
    currency: 'NGN',
    createdAt: iso(),
    deliveries,
  };
}

// ─── Invoices ───────────────────────────────────────────────────────────────
export function mockInvoices(): BusinessInvoice[] {
  return [
    {
      id: 'inv_1', periodLabel: 'June 2026', status: 'open', deliveryCount: 18,
      amountKobo: 240_000_00, currency: 'NGN', issuedAt: null, dueAt: null, paidAt: null,
    },
    {
      id: 'inv_2', periodLabel: 'May 2026', status: 'paid', deliveryCount: 42,
      amountKobo: 612_500_00, currency: 'NGN',
      issuedAt: iso(86_400_000 * 30), dueAt: iso(86_400_000 * 16), paidAt: iso(86_400_000 * 20),
    },
    {
      id: 'inv_3', periodLabel: 'April 2026', status: 'overdue', deliveryCount: 31,
      amountKobo: 418_000_00, currency: 'NGN',
      issuedAt: iso(86_400_000 * 60), dueAt: iso(86_400_000 * 46), paidAt: null,
    },
  ];
}

// ─── Analytics (derived from the seed) ────────────────────────────────────────
export function mockAnalytics(): BusinessAnalytics {
  ensureSeed();
  const all = [...logisticsStore.deliveries, ...logisticsStore.batches.flatMap((b) => b.deliveries)];
  const total = all.length;
  const success = all.filter((d) => d.status === 'delivered').length;
  const failed = all.filter((d) => d.status === 'failed').length;
  const codCollected = all.filter((d) => d.status === 'delivered').reduce((s, d) => s + d.codKobo, 0);
  const spend = all.reduce((s, d) => s + d.fareKobo, 0);
  return {
    totalDeliveries: total,
    successCount: success,
    failedCount: failed,
    successRate: total ? success / total : 0,
    codCollectedKobo: codCollected,
    spendKobo: spend,
    currency: 'NGN',
  };
}
