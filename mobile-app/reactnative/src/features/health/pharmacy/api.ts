// ── Paymax Health — Pharmacy API layer (Phase 1) ─────────────────────────────
// Self-contained, mock-first data layer for the Pharmacy vertical. Reuses the
// shared USE_MOCK flag + HEALTH_API_BASE; live endpoints live under /pharmacy.
// IRON RULES: kobo only · HL-3 Rx gating · HL-5 NAFDAC catalog · HL-9 held payment
// (order/checkout carry an Idempotency-Key, inheriting NL-9).

import { api } from '@/api/client';
import { USE_MOCK, HEALTH_API_BASE } from '../constants/health.constants';
import { Colors } from '@/constants/colors';
import type {
  PharmacyProduct,
  PharmacyVendor,
  Prescription,
  PharmacyOrder,
  CreateOrderInput,
  MedicationItem,
  Refill,
  PharmacyReview,
  SubmitReviewInput,
  RxStatus,
  PharmacistConsultMessage,
  ProviderOnboardingState,
  CatalogStockItem,
  ProviderRxQueueItem,
  RxDecision,
  ControlledLogEntry,
  ProviderEarnings,
  StockAlert,
  ProductCategory,
} from './types';

const PHARMACY_API = `${HEALTH_API_BASE}/pharmacy`;
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// ── Mock data ─────────────────────────────────────────────────────────────────
const MOCK_PRODUCTS: PharmacyProduct[] = [
  {
    id: 'prod_amox',
    pharmacyId: 'ph_health',
    pharmacyName: 'HealthPlus Pharmacy',
    name: 'Amoxicillin',
    brand: 'Emzor',
    form: '500mg · 21 capsules',
    category: 'prescription',
    priceKobo: 285000,
    nafdacReg: 'A4-0123',
    rxRequired: true,
    imageColor: Colors.iconBgBlue,
    description: 'Broad-spectrum antibiotic for bacterial infections. Prescription required.',
    inStock: true,
    rating: 4.6,
    reviewCount: 214,
    manufacturer: 'Emzor Pharmaceuticals',
    activeIngredient: 'Amoxicillin trihydrate',
    usage: 'Take one capsule three times daily, or as directed by your doctor.',
    sideEffects: 'Nausea, diarrhoea, rash. Stop and seek help if breathing difficulty occurs.',
    storage: 'Store below 25°C, away from moisture.',
  },
  {
    id: 'prod_lisin',
    pharmacyId: 'ph_medplus',
    pharmacyName: 'MedPlus',
    name: 'Lisinopril',
    brand: 'Swiss Pharma',
    form: '10mg · 30 tablets',
    category: 'prescription',
    priceKobo: 420000,
    nafdacReg: 'A4-7781',
    rxRequired: true,
    imageColor: Colors.iconBgPurple,
    description: 'ACE inhibitor for high blood pressure. Prescription required.',
    inStock: true,
    rating: 4.7,
    reviewCount: 98,
    manufacturer: 'Swiss Pharma Nigeria',
    activeIngredient: 'Lisinopril dihydrate',
    usage: 'One tablet once daily. Do not stop without medical advice.',
    sideEffects: 'Dry cough, dizziness. Report swelling of face/lips immediately.',
    storage: 'Store in a cool, dry place.',
  },
  {
    id: 'prod_para',
    pharmacyId: 'ph_health',
    pharmacyName: 'HealthPlus Pharmacy',
    name: 'Paracetamol',
    brand: 'M&B',
    form: '500mg · 24 tablets',
    category: 'otc',
    priceKobo: 65000,
    nafdacReg: 'A4-0991',
    rxRequired: false,
    imageColor: Colors.iconBgTeal,
    description: 'Pain relief and fever reducer. Available over the counter.',
    inStock: true,
    rating: 4.8,
    reviewCount: 1203,
    manufacturer: 'May & Baker Nigeria',
    activeIngredient: 'Paracetamol',
    usage: 'One to two tablets every 4–6 hours. Max 8 tablets in 24 hours.',
    sideEffects: 'Rare at recommended doses. Do not exceed stated dose.',
    storage: 'Store below 30°C.',
  },
  {
    id: 'prod_vitc',
    pharmacyId: 'ph_alpha',
    pharmacyName: 'Alpha Pharmacy',
    name: 'Vitamin C',
    brand: 'Nature’s Field',
    form: '1000mg · 30 tablets',
    category: 'wellness',
    priceKobo: 180000,
    nafdacReg: 'B1-4420',
    rxRequired: false,
    imageColor: Colors.iconBgGold,
    description: 'Immune support supplement.',
    inStock: true,
    rating: 4.5,
    reviewCount: 540,
    manufacturer: 'Nature’s Field',
    activeIngredient: 'Ascorbic acid',
    usage: 'One tablet daily after a meal.',
    storage: 'Keep tightly closed in a dry place.',
  },
  {
    id: 'prod_oral',
    pharmacyId: 'ph_medplus',
    pharmacyName: 'MedPlus',
    name: 'ORS Sachets',
    brand: 'Emzor',
    form: '10 sachets',
    category: 'first_aid',
    priceKobo: 90000,
    nafdacReg: 'A4-3310',
    rxRequired: false,
    imageColor: Colors.iconBgGreen,
    description: 'Oral rehydration salts for dehydration.',
    inStock: true,
    rating: 4.7,
    reviewCount: 322,
    manufacturer: 'Emzor Pharmaceuticals',
    usage: 'Dissolve one sachet in 500ml clean water. Drink as needed.',
    storage: 'Store in a dry place.',
  },
  {
    id: 'prod_bp',
    pharmacyId: 'ph_alpha',
    pharmacyName: 'Alpha Pharmacy',
    name: 'BP Monitor',
    brand: 'Omron',
    form: 'Upper arm, automatic',
    category: 'devices',
    priceKobo: 3850000,
    nafdacReg: 'MD-2207',
    rxRequired: false,
    imageColor: Colors.iconBgBlue,
    description: 'Automatic blood pressure monitor for home use.',
    inStock: false,
    rating: 4.9,
    reviewCount: 76,
    manufacturer: 'Omron Healthcare',
    storage: 'Keep dry; store cuff loosely.',
  },
  {
    id: 'prod_baby',
    pharmacyId: 'ph_health',
    pharmacyName: 'HealthPlus Pharmacy',
    name: 'Infant Multivitamin',
    brand: 'Astymin',
    form: 'Syrup · 100ml',
    category: 'baby',
    priceKobo: 145000,
    nafdacReg: 'B1-9920',
    rxRequired: false,
    imageColor: Colors.iconBgTeal,
    description: 'Daily multivitamin syrup for infants.',
    inStock: true,
    rating: 4.4,
    reviewCount: 188,
    manufacturer: 'Tabros Pharma',
    usage: '5ml once daily or as advised by a paediatrician.',
    storage: 'Refrigerate after opening.',
  },
];

const MOCK_PHARMACIES: PharmacyVendor[] = [
  {
    id: 'ph_health',
    name: 'HealthPlus Pharmacy',
    credential: { authority: 'PCN', licenseNo: 'PCN/LA/2291', status: 'verified', expiresAt: '2027-03-31' },
    premisesVerified: true,
    address: '14 Adeola Odeku St, Victoria Island, Lagos',
    distanceKm: 1.2,
    rating: 4.8,
    reviewCount: 1420,
    etaLabel: '30–45 min',
    deliveryFeeKobo: 120000,
    supportsPickup: true,
    supportsDelivery: true,
    open: true,
  },
  {
    id: 'ph_medplus',
    name: 'MedPlus',
    credential: { authority: 'PCN', licenseNo: 'PCN/LA/3387', status: 'verified', expiresAt: '2026-12-31' },
    premisesVerified: true,
    address: '5 Awolowo Rd, Ikoyi, Lagos',
    distanceKm: 2.7,
    rating: 4.6,
    reviewCount: 880,
    etaLabel: '45–60 min',
    deliveryFeeKobo: 90000,
    supportsPickup: true,
    supportsDelivery: true,
    open: true,
  },
  {
    id: 'ph_alpha',
    name: 'Alpha Pharmacy',
    credential: { authority: 'PCN', licenseNo: 'PCN/LA/1102', status: 'verified', expiresAt: '2026-08-31' },
    premisesVerified: true,
    address: '22 Allen Ave, Ikeja, Lagos',
    distanceKm: 6.4,
    rating: 4.5,
    reviewCount: 410,
    etaLabel: '60–90 min',
    deliveryFeeKobo: 150000,
    supportsPickup: true,
    supportsDelivery: false,
    open: false,
  },
];

const MOCK_PRESCRIPTIONS: Prescription[] = [
  {
    id: 'rx_verifying',
    source: 'upload',
    status: 'verifying',
    uploadedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    patientName: 'Ada Obi',
    prescriberName: 'Dr. Bello',
    docColor: Colors.iconBgBlue,
    items: [
      { name: 'Amoxicillin 500mg', dosage: '1 cap, 3x daily', quantity: '21 capsules', productId: 'prod_amox' },
    ],
  },
  {
    id: 'rx_verified',
    source: 'consult',
    status: 'verified',
    uploadedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    verifiedAt: new Date(Date.now() - 86_400_000).toISOString(),
    pharmacyName: 'HealthPlus Pharmacy',
    pharmacistName: 'Pharm. Grace E.',
    patientName: 'Ada Obi',
    prescriberName: 'Dr. Bello',
    docColor: Colors.iconBgTeal,
    items: [
      { name: 'Lisinopril 10mg', dosage: '1 tab daily', quantity: '30 tablets', productId: 'prod_lisin' },
    ],
  },
  {
    id: 'rx_rejected',
    source: 'upload',
    status: 'rejected',
    uploadedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    pharmacistNote: 'Image is blurred and the prescriber signature is not legible. Please re-upload a clear photo.',
    patientName: 'Ada Obi',
    docColor: Colors.iconBgRed,
    items: [],
  },
];

const MOCK_ORDER: PharmacyOrder = {
  id: 'ord_1',
  reference: 'PHX-48213',
  status: 'in_delivery',
  fulfilment: 'delivery',
  pharmacyId: 'ph_health',
  pharmacyName: 'HealthPlus Pharmacy',
  lines: [
    { productId: 'prod_lisin', name: 'Lisinopril', form: '10mg · 30 tablets', priceKobo: 420000, qty: 1, rxRequired: true, imageColor: Colors.iconBgPurple },
    { productId: 'prod_para', name: 'Paracetamol', form: '500mg · 24 tablets', priceKobo: 65000, qty: 2, rxRequired: false, imageColor: Colors.iconBgTeal },
  ],
  subtotalKobo: 550000,
  deliveryFeeKobo: 120000,
  totalKobo: 670000,
  paymentHeld: true,
  createdAt: new Date(Date.now() - 90 * 60_000).toISOString(),
  rider: { name: 'Tunde A.', phone: '+2348012345678', vehicle: 'Bike · LAG-221-KJA' },
  etaLabel: '15 min away',
  requiresRx: true,
  rxId: 'rx_verified',
  timeline: [
    { status: 'created', label: 'Order placed · payment held', at: new Date(Date.now() - 90 * 60_000).toISOString(), done: true },
    { status: 'confirmed', label: 'Confirmed by pharmacy', at: new Date(Date.now() - 70 * 60_000).toISOString(), done: true },
    { status: 'dispensed', label: 'Dispensed & packed', at: new Date(Date.now() - 40 * 60_000).toISOString(), done: true },
    { status: 'in_delivery', label: 'Out for delivery', at: new Date(Date.now() - 25 * 60_000).toISOString(), done: true },
    { status: 'delivered', label: 'Delivered', done: false },
  ],
};

const MOCK_PICKUP_ORDER: PharmacyOrder = {
  id: 'ord_2',
  reference: 'PHX-48107',
  status: 'ready_for_pickup',
  fulfilment: 'pickup',
  pharmacyId: 'ph_medplus',
  pharmacyName: 'MedPlus',
  lines: [
    { productId: 'prod_vitc', name: 'Vitamin C', form: '1000mg · 30 tablets', priceKobo: 180000, qty: 1, rxRequired: false, imageColor: Colors.iconBgGold },
  ],
  subtotalKobo: 180000,
  deliveryFeeKobo: 0,
  totalKobo: 180000,
  paymentHeld: true,
  createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  pickupCode: '4827',
  requiresRx: false,
  timeline: [
    { status: 'created', label: 'Order placed · payment held', at: new Date(Date.now() - 5 * 86_400_000).toISOString(), done: true },
    { status: 'confirmed', label: 'Confirmed by pharmacy', done: true },
    { status: 'dispensed', label: 'Dispensed & packed', done: true },
    { status: 'ready_for_pickup', label: 'Ready for pickup', done: true },
    { status: 'collected', label: 'Collected', done: false },
  ],
};

const MOCK_PAST_ORDER: PharmacyOrder = {
  id: 'ord_3',
  reference: 'PHX-47990',
  status: 'closed',
  fulfilment: 'delivery',
  pharmacyId: 'ph_health',
  pharmacyName: 'HealthPlus Pharmacy',
  lines: [
    { productId: 'prod_oral', name: 'ORS Sachets', form: '10 sachets', priceKobo: 90000, qty: 1, rxRequired: false, imageColor: Colors.iconBgGreen },
  ],
  subtotalKobo: 90000,
  deliveryFeeKobo: 120000,
  totalKobo: 210000,
  paymentHeld: false,
  createdAt: new Date(Date.now() - 12 * 86_400_000).toISOString(),
  requiresRx: false,
  timeline: [
    { status: 'created', label: 'Order placed', at: new Date(Date.now() - 12 * 86_400_000).toISOString(), done: true },
    { status: 'delivered', label: 'Delivered · payment released', at: new Date(Date.now() - 12 * 86_400_000 + 3600_000).toISOString(), done: true },
    { status: 'closed', label: 'Closed', done: true },
  ],
};

let ORDERS: PharmacyOrder[] = [MOCK_ORDER, MOCK_PICKUP_ORDER, MOCK_PAST_ORDER];

const MOCK_MEDS: MedicationItem[] = [
  { id: 'med_lisin', name: 'Lisinopril', form: '10mg', schedule: '1 tablet · once daily', adherence: 92, daysLeft: 6, rxRequired: true, productId: 'prod_lisin' },
  { id: 'med_vitc', name: 'Vitamin C', form: '1000mg', schedule: '1 tablet · once daily', adherence: 78, daysLeft: 18, rxRequired: false, productId: 'prod_vitc' },
];

const MOCK_REFILLS: Refill[] = [
  { id: 'rf_lisin', medicationName: 'Lisinopril 10mg', form: '30 tablets', dueAt: new Date(Date.now() + 6 * 86_400_000).toISOString(), scheduled: false, autoRefill: true, rxId: 'rx_verified', productId: 'prod_lisin' },
  { id: 'rf_vitc', medicationName: 'Vitamin C 1000mg', form: '30 tablets', dueAt: new Date(Date.now() + 18 * 86_400_000).toISOString(), scheduled: false, autoRefill: false, productId: 'prod_vitc' },
];

const MOCK_REVIEWS: PharmacyReview[] = [
  { id: 'rv_1', author: 'Chidi N.', rating: 5, body: 'Fast delivery and the pharmacist called to confirm dosage. Excellent.', at: new Date(Date.now() - 4 * 86_400_000).toISOString(), orderRef: 'PHX-47990' },
  { id: 'rv_2', author: 'Funke A.', rating: 4, body: 'Good service, packaging was discreet. Delivery was slightly late.', at: new Date(Date.now() - 9 * 86_400_000).toISOString() },
];

// ── Customer: catalog ─────────────────────────────────────────────────────────

// Deterministic thumbnail tint so the same product always renders the same colour
// (the minimal backend catalog carries no image/colour of its own).
const PRODUCT_TINTS = [
  Colors.iconBgPurple, Colors.iconBgBlue, Colors.iconBgTeal,
  Colors.iconBgOrange, Colors.iconBgGold, Colors.iconBgGreen,
];
function tintForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % PRODUCT_TINTS.length;
  return PRODUCT_TINTS[h];
}

// Map the backend's minimal money-path product row (snake_case; see Go
// pharmacy.Product) onto the richer mobile PharmacyProduct display shape.
// Fields the backend does not (yet) store — brand/form/description/rating/
// manufacturer — default to empty/zero so the card still renders; the card and
// detail screens already guard on these. pharmacyId/pharmacyName carry the
// owning-pharmacy attribution added in ADR-017.
function mapProduct(raw: any): PharmacyProduct {
  return {
    id: raw.id,
    pharmacyId: raw.pharmacy_provider_id ?? '',
    pharmacyName: raw.pharmacy_name ?? '',
    name: raw.name ?? '',
    brand: raw.brand ?? '',
    form: raw.form ?? '',
    // Backend has no category column; approximate from the Rx flag so the
    // category filter still buckets sensibly until the catalog model is enriched.
    category: raw.rx_required ? 'prescription' : 'otc',
    priceKobo: raw.price_kobo ?? 0,
    nafdacReg: raw.nafdac_ref ?? '',
    rxRequired: !!raw.rx_required,
    controlled: !!raw.is_controlled,
    imageColor: tintForId(String(raw.id ?? '')),
    description: raw.description ?? '',
    inStock: (raw.active ?? true) && (raw.stock_qty ?? 0) > 0,
    rating: raw.rating ?? 0,
    reviewCount: raw.review_count ?? 0,
    manufacturer: raw.manufacturer ?? '',
  };
}

export async function getProducts(opts?: { q?: string; category?: ProductCategory }): Promise<PharmacyProduct[]> {
  if (USE_MOCK) {
    await delay();
    let out = [...MOCK_PRODUCTS];
    if (opts?.category) out = out.filter((p) => p.category === opts.category);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      out = out.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q) ||
          p.pharmacyName.toLowerCase().includes(q) ||
          (p.activeIngredient ?? '').toLowerCase().includes(q),
      );
    }
    return out;
  }
  const { data } = await api.get<{ products?: unknown[] }>(`${PHARMACY_API}/products`, { params: opts });
  return (data.products ?? []).map(mapProduct);
}

export async function getProduct(id: string): Promise<PharmacyProduct> {
  if (USE_MOCK) {
    await delay();
    const p = MOCK_PRODUCTS.find((x) => x.id === id);
    if (!p) throw new Error('Product not found');
    return p;
  }
  const { data } = await api.get<{ product?: unknown }>(`${PHARMACY_API}/products/${id}`);
  if (!data.product) throw new Error('Product not found');
  return mapProduct(data.product);
}

// ── Customer: pharmacies ───────────────────────────────────────────────────────
// GET /pharmacy/pharmacies — multi-pharmacy discovery (ADR-017). Sorted by
// PostGIS distance when lat/lng are supplied, otherwise by rating/name; the
// server resolves the actual sort (see backend resolveSort) so a caller
// without coordinates gets a sensible rating-sorted list rather than an error.
export interface DiscoverPharmaciesOpts {
  lat?: number;
  lng?: number;
  radiusM?: number;
  sort?: 'distance' | 'rating' | 'name';
  /** Case-insensitive search on the pharmacy name (server-side ILIKE). */
  q?: string;
}

// The Go handler returns snake_case (health_providers-shaped) JSON; this app's
// types are camelCase, so live responses are mapped explicitly rather than
// assumed pass-through-compatible with the mock shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPharmacyProfile(raw: any): PharmacyVendor {
  return {
    id: raw.provider_id,
    name: raw.display_name,
    credential: { authority: 'PCN', licenseNo: '', status: 'verified' },
    premisesVerified: true, // server-side HL-2 gate already filters to APPROVED+discoverable
    address: raw.address ?? '',
    distanceKm: typeof raw.distance_m === 'number' ? Math.round((raw.distance_m / 1000) * 10) / 10 : 0,
    rating: raw.avg_rating ?? 0,
    reviewCount: raw.rating_count ?? 0,
    etaLabel: raw.supports_delivery ? '30–60 min' : 'Pickup only',
    deliveryFeeKobo: raw.delivery_fee_kobo ?? 0,
    supportsPickup: raw.supports_pickup ?? true,
    supportsDelivery: raw.supports_delivery ?? true,
    open: true,
  };
}

export async function getPharmacies(opts?: DiscoverPharmaciesOpts): Promise<PharmacyVendor[]> {
  if (USE_MOCK) {
    await delay();
    // HL-2: only credential-verified + premises-verified pharmacies are discoverable.
    let out = MOCK_PHARMACIES.filter((p) => p.credential.status === 'verified' && p.premisesVerified);
    const q = opts?.q?.trim().toLowerCase();
    if (q) out = out.filter((p) => p.name.toLowerCase().includes(q));
    if (opts?.sort === 'rating') out = [...out].sort((a, b) => b.rating - a.rating);
    else out = [...out].sort((a, b) => a.distanceKm - b.distanceKm);
    return out;
  }
  const { data } = await api.get<{ pharmacies: unknown[] }>(`${PHARMACY_API}/pharmacies`, {
    params: { lat: opts?.lat, lng: opts?.lng, radius_m: opts?.radiusM, sort: opts?.sort, q: opts?.q?.trim() || undefined },
  });
  return (data.pharmacies ?? []).map(mapPharmacyProfile);
}

export async function getPharmacy(id: string): Promise<PharmacyVendor> {
  if (USE_MOCK) {
    await delay();
    const p = MOCK_PHARMACIES.find((x) => x.id === id);
    if (!p) throw new Error('Pharmacy not found');
    return p;
  }
  const { data } = await api.get<{ pharmacy: unknown }>(`${PHARMACY_API}/pharmacies/${id}`);
  return mapPharmacyProfile(data.pharmacy);
}

// ── Customer: prescriptions (HL-3) ────────────────────────────────────────────
export async function getPrescriptions(): Promise<Prescription[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_PRESCRIPTIONS].sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt));
  }
  const { data } = await api.get<Prescription[]>(`${PHARMACY_API}/prescriptions`);
  return data;
}

export async function getPrescription(id: string): Promise<Prescription> {
  if (USE_MOCK) {
    await delay();
    const rx = MOCK_PRESCRIPTIONS.find((r) => r.id === id);
    if (!rx) throw new Error('Prescription not found');
    return rx;
  }
  const { data } = await api.get<Prescription>(`${PHARMACY_API}/prescriptions/${id}`);
  return data;
}

/** Upload an Rx for pharmacist verification (HL-3) → enters VERIFYING. */
export async function uploadPrescription(input: { patientName: string; note?: string }): Promise<Prescription> {
  if (USE_MOCK) {
    await delay(600);
    const rx: Prescription = {
      id: `rx_${Date.now()}`,
      source: 'upload',
      status: 'verifying',
      uploadedAt: new Date().toISOString(),
      patientName: input.patientName,
      docColor: Colors.iconBgBlue,
      items: [],
    };
    MOCK_PRESCRIPTIONS.unshift(rx);
    return rx;
  }
  const { data } = await api.post<Prescription>(`${PHARMACY_API}/prescriptions/upload`, input);
  return data;
}

// ── Customer: orders (HL-9 payment HELD; Idempotency-Key) ─────────────────────
export async function getOrders(): Promise<PharmacyOrder[]> {
  if (USE_MOCK) {
    await delay();
    return [...ORDERS].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  const { data } = await api.get<PharmacyOrder[]>(`${PHARMACY_API}/orders`);
  return data;
}

export async function getOrder(id: string): Promise<PharmacyOrder> {
  if (USE_MOCK) {
    await delay();
    const o = ORDERS.find((x) => x.id === id);
    if (!o) throw new Error('Order not found');
    return o;
  }
  const { data } = await api.get<PharmacyOrder>(`${PHARMACY_API}/orders/${id}`);
  return data;
}

/**
 * Create an order. HL-9: payment is captured to a HELD balance on CREATED; the
 * Idempotency-Key guards the money mutation (NL-9). Rx-required carts that lack a
 * verified Rx land in RX_PENDING.
 */
export async function createOrder(input: CreateOrderInput): Promise<PharmacyOrder> {
  const subtotalKobo = input.lines.reduce((s, l) => s + l.priceKobo * l.qty, 0);
  const pharmacy = MOCK_PHARMACIES.find((p) => p.id === input.pharmacyId);
  const deliveryFeeKobo = input.fulfilment === 'delivery' ? pharmacy?.deliveryFeeKobo ?? 120000 : 0;
  const requiresRx = input.lines.some((l) => l.rxRequired);

  if (USE_MOCK) {
    await delay(500);
    const order: PharmacyOrder = {
      id: `ord_${Date.now()}`,
      reference: `PHX-${Math.floor(40000 + Math.random() * 9999)}`,
      status: requiresRx && !input.rxId ? 'rx_pending' : 'confirmed',
      fulfilment: input.fulfilment,
      pharmacyId: input.pharmacyId,
      pharmacyName: pharmacy?.name ?? 'Pharmacy',
      lines: input.lines,
      subtotalKobo,
      deliveryFeeKobo,
      totalKobo: subtotalKobo + deliveryFeeKobo,
      paymentHeld: true,
      createdAt: new Date().toISOString(),
      pickupCode: input.fulfilment === 'pickup' ? String(1000 + Math.floor(Math.random() * 8999)) : undefined,
      etaLabel: input.fulfilment === 'delivery' ? pharmacy?.etaLabel : 'Ready in ~30 min',
      requiresRx,
      rxId: input.rxId,
      timeline: [
        { status: 'created', label: 'Order placed · payment held', at: new Date().toISOString(), done: true },
        requiresRx && !input.rxId
          ? { status: 'rx_pending', label: 'Awaiting Rx verification', done: false }
          : { status: 'confirmed', label: 'Confirmed by pharmacy', at: new Date().toISOString(), done: true },
        { status: 'dispensed', label: 'Dispensed & packed', done: false },
        input.fulfilment === 'delivery'
          ? { status: 'delivered', label: 'Delivered', done: false }
          : { status: 'collected', label: 'Collected', done: false },
      ],
    };
    ORDERS = [order, ...ORDERS];
    return order;
  }
  // Additive: contract takes an optional top-level snake_case `search_event_id`.
  const { searchEventId, ...body } = input;
  const { data } = await api.post<PharmacyOrder>(
    `${PHARMACY_API}/orders`,
    searchEventId ? { ...body, search_event_id: searchEventId } : body,
    { headers: { 'Idempotency-Key': input.idempotencyKey } },
  );
  return data;
}

export async function reorder(orderId: string): Promise<PharmacyOrder['lines']> {
  if (USE_MOCK) {
    await delay();
    const o = ORDERS.find((x) => x.id === orderId);
    if (!o) throw new Error('Order not found');
    return o.lines;
  }
  const { data } = await api.post<PharmacyOrder['lines']>(`${PHARMACY_API}/orders/${orderId}/reorder`, {});
  return data;
}

// ── Customer: medications & refills ───────────────────────────────────────────
export async function getMedications(): Promise<MedicationItem[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_MEDS;
  }
  const { data } = await api.get<MedicationItem[]>(`${PHARMACY_API}/medications`);
  return data;
}

export async function getRefills(): Promise<Refill[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_REFILLS;
  }
  const { data } = await api.get<Refill[]>(`${PHARMACY_API}/refills`);
  return data;
}

export async function scheduleRefill(id: string, autoRefill: boolean): Promise<Refill> {
  if (USE_MOCK) {
    await delay(350);
    const rf = MOCK_REFILLS.find((r) => r.id === id);
    if (!rf) throw new Error('Refill not found');
    rf.scheduled = true;
    rf.autoRefill = autoRefill;
    return { ...rf };
  }
  const { data } = await api.post<Refill>(`${PHARMACY_API}/refills/${id}/schedule`, { autoRefill });
  return data;
}

// ── Customer: ratings ─────────────────────────────────────────────────────────
// GET /pharmacy/pharmacies/{id}/reviews (ADR-017) — the live surface is always
// scoped to a specific pharmacy; there is no cross-pharmacy review feed.
export async function getReviews(pharmacyId?: string): Promise<PharmacyReview[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_REVIEWS;
  }
  if (!pharmacyId) return [];
  const { data } = await api.get<{ reviews: Array<{ id: string; rating: number; body: string; created_at: string }> }>(
    `${PHARMACY_API}/pharmacies/${pharmacyId}/reviews`,
  );
  // HL-8: the backend never exposes the reviewer's identity — the author label
  // is display-only filler, matching what a reviews list can legitimately show.
  return (data.reviews ?? []).map((r) => ({ id: r.id, author: 'Verified patient', rating: r.rating, body: r.body, at: r.created_at }));
}

/** Submit a review for a completed order (HL-2 rating input; ADR-017). The
 * live path requires `orderId` — a rating always attaches to a fulfilled
 * pharmacy_orders row, gated server-side to DELIVERED/COLLECTED/CLOSED. */
export async function submitReview(input: SubmitReviewInput): Promise<PharmacyReview> {
  if (USE_MOCK) {
    await delay(400);
    const rv: PharmacyReview = {
      id: `rv_${Date.now()}`,
      author: 'You',
      rating: input.rating,
      body: input.body,
      at: new Date().toISOString(),
      orderRef: input.orderId,
    };
    MOCK_REVIEWS.unshift(rv);
    return rv;
  }
  if (!input.orderId) {
    throw new Error('A completed order is required to leave a review.');
  }
  const { data } = await api.post<{ review: { id: string; rating: number; body: string; created_at: string } }>(
    `${PHARMACY_API}/orders/${input.orderId}/reviews`,
    { rating: input.rating, body: input.body },
  );
  const r = data.review;
  return { id: r.id, author: 'You', rating: r.rating, body: r.body, at: r.created_at, orderRef: input.orderId };
}

// ── Customer: pharmacist consult (lightweight chat) ───────────────────────────
let CONSULT_THREAD: PharmacistConsultMessage[] = [
  { id: 'pc_1', fromPharmacist: true, author: 'Pharm. Grace E.', body: 'Hello! How can I help with your medication today?', at: new Date(Date.now() - 8 * 60_000).toISOString() },
];

export async function getConsultThread(): Promise<PharmacistConsultMessage[]> {
  if (USE_MOCK) {
    await delay(200);
    return [...CONSULT_THREAD];
  }
  const { data } = await api.get<PharmacistConsultMessage[]>(`${PHARMACY_API}/consult/messages`);
  return data;
}

export async function sendConsultMessage(body: string): Promise<PharmacistConsultMessage> {
  const msg: PharmacistConsultMessage = { id: `pc_${Date.now()}`, fromPharmacist: false, author: 'You', body, at: new Date().toISOString() };
  if (USE_MOCK) {
    await delay(150);
    CONSULT_THREAD = [...CONSULT_THREAD, msg];
    return msg;
  }
  const { data } = await api.post<PharmacistConsultMessage>(`${PHARMACY_API}/consult/messages`, { body });
  return data;
}

// ── Provider: onboarding (HL-2) ───────────────────────────────────────────────
export async function getProviderOnboarding(): Promise<ProviderOnboardingState> {
  if (USE_MOCK) {
    await delay();
    return { status: 'under_review', pcnLicenseNo: 'PCN/LA/9921', pcnStatus: 'pending', premisesVerified: false, businessName: 'Wellness Hub Pharmacy' };
  }
  const { data } = await api.get<ProviderOnboardingState>(`${PHARMACY_API}/provider/onboarding`);
  return data;
}

export async function submitProviderOnboarding(input: Partial<ProviderOnboardingState>): Promise<ProviderOnboardingState> {
  if (USE_MOCK) {
    await delay(500);
    return {
      status: 'submitted',
      pcnLicenseNo: input.pcnLicenseNo,
      pcnStatus: 'pending',
      premisesVerified: false,
      businessName: input.businessName,
    };
  }
  const { data } = await api.post<ProviderOnboardingState>(`${PHARMACY_API}/provider/onboarding/submit`, input);
  return data;
}

// ── Provider: catalog / stock ─────────────────────────────────────────────────
const MOCK_CATALOG: CatalogStockItem[] = [
  { productId: 'prod_amox', name: 'Amoxicillin', form: '500mg · 21 capsules', priceKobo: 285000, nafdacReg: 'A4-0123', rxRequired: true, stock: 48, reorderLevel: 20, active: true },
  { productId: 'prod_lisin', name: 'Lisinopril', form: '10mg · 30 tablets', priceKobo: 420000, nafdacReg: 'A4-7781', rxRequired: true, stock: 12, reorderLevel: 15, active: true },
  { productId: 'prod_para', name: 'Paracetamol', form: '500mg · 24 tablets', priceKobo: 65000, nafdacReg: 'A4-0991', rxRequired: false, stock: 4, reorderLevel: 30, active: true },
  { productId: 'prod_vitc', name: 'Vitamin C', form: '1000mg · 30 tablets', priceKobo: 180000, nafdacReg: 'B1-4420', rxRequired: false, stock: 0, reorderLevel: 25, active: false },
];

export async function getProviderCatalog(): Promise<CatalogStockItem[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_CATALOG];
  }
  const { data } = await api.get<CatalogStockItem[]>(`${PHARMACY_API}/provider/catalog`);
  return data;
}

export async function getStockAlerts(): Promise<StockAlert[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_CATALOG
      .filter((c) => c.stock <= c.reorderLevel)
      .map((c) => ({ productId: c.productId, name: c.name, stock: c.stock, reorderLevel: c.reorderLevel, severity: c.stock === 0 ? 'out' : 'low' }));
  }
  const { data } = await api.get<StockAlert[]>(`${PHARMACY_API}/provider/stock-alerts`);
  return data;
}

// ── Provider: orders queue + dispense + handoff ───────────────────────────────
export async function getProviderOrders(): Promise<PharmacyOrder[]> {
  if (USE_MOCK) {
    await delay();
    return [...ORDERS];
  }
  const { data } = await api.get<PharmacyOrder[]>(`${PHARMACY_API}/provider/orders`);
  return data;
}

/** Pharmacist marks an order dispensed & packed (consumes Rx dispense-once, HL-3). */
export async function dispenseOrder(orderId: string, idempotencyKey: string): Promise<PharmacyOrder> {
  if (USE_MOCK) {
    await delay(400);
    const o = ORDERS.find((x) => x.id === orderId);
    if (!o) throw new Error('Order not found');
    o.status = 'dispensed';
    return { ...o };
  }
  const { data } = await api.post<PharmacyOrder>(`${PHARMACY_API}/orders/${orderId}/dispense`, {}, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return data;
}

/** Hand off to last-mile delivery or mark ready for pickup. */
export async function handoffOrder(orderId: string, mode: 'dispatch' | 'pickup', idempotencyKey: string): Promise<PharmacyOrder> {
  if (USE_MOCK) {
    await delay(400);
    const o = ORDERS.find((x) => x.id === orderId);
    if (!o) throw new Error('Order not found');
    o.status = mode === 'dispatch' ? 'in_delivery' : 'ready_for_pickup';
    return { ...o };
  }
  const { data } = await api.post<PharmacyOrder>(`${PHARMACY_API}/orders/${orderId}/${mode === 'dispatch' ? 'dispatch' : 'ready'}`, {}, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return data;
}

// ── Provider: Rx verification (HL-3) ──────────────────────────────────────────
export async function getProviderRxQueue(): Promise<ProviderRxQueueItem[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PRESCRIPTIONS.filter((r) => r.status === 'verifying' || r.status === 'clarification').map((r) => ({
      rxId: r.id,
      patientName: r.patientName,
      prescriberName: r.prescriberName,
      uploadedAt: r.uploadedAt,
      itemCount: r.items.length,
      status: r.status,
    }));
  }
  const { data } = await api.get<ProviderRxQueueItem[]>(`${PHARMACY_API}/provider/rx-queue`);
  return data;
}

export async function decideRx(rxId: string, decision: RxDecision, note?: string): Promise<Prescription> {
  if (USE_MOCK) {
    await delay(450);
    const rx = MOCK_PRESCRIPTIONS.find((r) => r.id === rxId);
    if (!rx) throw new Error('Prescription not found');
    const nextStatus: RxStatus = decision === 'approve' ? 'verified' : decision === 'reject' ? 'rejected' : 'clarification';
    rx.status = nextStatus;
    rx.pharmacistNote = note;
    if (decision === 'approve') rx.verifiedAt = new Date().toISOString();
    return { ...rx };
  }
  const { data } = await api.post<Prescription>(`${PHARMACY_API}/prescriptions/${rxId}/verify`, { decision, note });
  return data;
}

// ── Provider: controlled-substance log (HL-4) ─────────────────────────────────
export async function getControlledLog(): Promise<ControlledLogEntry[]> {
  if (USE_MOCK) {
    await delay();
    return [
      { id: 'cl_1', drugName: 'Codeine syrup (restricted)', patientName: 'Withheld', quantity: '1 × 100ml', pharmacistName: 'Pharm. Grace E.', registerRef: 'CR-2026-0042', at: new Date(Date.now() - 86_400_000).toISOString() },
    ];
  }
  const { data } = await api.get<ControlledLogEntry[]>(`${PHARMACY_API}/provider/controlled-log`);
  return data;
}

// ── Provider: earnings & payouts (HL-9/HL-10) ─────────────────────────────────
export async function getProviderEarnings(): Promise<ProviderEarnings> {
  if (USE_MOCK) {
    await delay();
    return {
      availableKobo: 1845000,
      pendingKobo: 670000,
      lifetimeKobo: 28940000,
      payouts: [
        { id: 'po_1', amountKobo: 5000000, at: new Date(Date.now() - 7 * 86_400_000).toISOString(), status: 'paid' },
        { id: 'po_2', amountKobo: 3200000, at: new Date(Date.now() - 1 * 86_400_000).toISOString(), status: 'processing' },
      ],
      settlements: [
        { orderRef: 'PHX-48213', grossKobo: 670000, feeKobo: 67000, netKobo: 603000, status: 'held', at: new Date(Date.now() - 90 * 60_000).toISOString() },
        { orderRef: 'PHX-47990', grossKobo: 210000, feeKobo: 21000, netKobo: 189000, status: 'released', at: new Date(Date.now() - 12 * 86_400_000).toISOString() },
      ],
    };
  }
  const { data } = await api.get<ProviderEarnings>(`${PHARMACY_API}/provider/earnings`);
  return data;
}

export async function requestPayout(amountKobo: number, idempotencyKey: string): Promise<{ ok: true }> {
  if (USE_MOCK) {
    await delay(500);
    return { ok: true };
  }
  await api.post(`${PHARMACY_API}/provider/payouts`, { amountKobo }, { headers: { 'Idempotency-Key': idempotencyKey } });
  return { ok: true };
}
