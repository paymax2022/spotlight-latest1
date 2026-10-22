// Self-contained, mock-first data layer for the Pharmacy vertical. Reuses the
// shared USE_MOCK flag + HEALTH_API_BASE; live endpoints live under /pharmacy.
// IRON RULES: kobo only · HL-3 Rx gating · HL-5 NAFDAC catalog · HL-9 held payment
// (order/checkout carry an Idempotency-Key, inheriting NL-9).

import { api } from '@/api/client';
import { USE_MOCK, HEALTH_API_BASE } from '../constants/health.constants';
import { uploadProviderCredential, addProviderCredential } from '../api';
import { Colors } from '@/constants/tokens';
import type {
  PharmacyProduct,
  PharmacyVendor,
  Prescription,
  PharmacyOrder,
  OrderStatus,
  OrderEvent,
  CartLine,
  CreateOrderInput,
  MedicationItem,
  PrescriptionRefill,
  RxItem,
  PharmacyReview,
  SubmitReviewInput,
  RxStatus,
  PharmacistConsultMessage,
  ProviderOnboardingState,
  CatalogStockItem,
  ProviderRxQueueItem,
  RxDecision,
  MyPharmacy,
  UpsertProductInput,
  ProviderEarnings,
  StockAlert,
  ProductCategory,
} from './types';

const PHARMACY_API = `${HEALTH_API_BASE}/pharmacy`;
const PROVIDERS_API = `${HEALTH_API_BASE}/providers`;
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

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
    // Issued by a consult and not yet sent anywhere — the state the patient's
    // "send to a pharmacy" action acts on.
    id: 'rx_issued',
    source: 'consult',
    status: 'issued',
    uploadedAt: new Date().toISOString(),
    patientName: 'Ada Obi',
    prescriberName: 'Dr. Bello',
    docColor: Colors.iconBgBlue,
    items: [
      { name: 'Paracetamol 500mg', dosage: '1 tab, 3x daily', quantity: '24 tablets', productId: 'prod_para' },
    ],
  },
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
    { productId: 'prod_amox', pharmacyId: 'ph_health', pharmacyName: 'HealthPlus Pharmacy', name: 'Amoxicillin', form: '500mg · 21 capsules', priceKobo: 285000, qty: 1, rxRequired: true, imageColor: Colors.iconBgBlue },
    { productId: 'prod_para', pharmacyId: 'ph_health', pharmacyName: 'HealthPlus Pharmacy', name: 'Paracetamol', form: '500mg · 24 tablets', priceKobo: 65000, qty: 2, rxRequired: false, imageColor: Colors.iconBgTeal },
  ],
  subtotalKobo: 415000,
  deliveryFeeKobo: 120000,
  totalKobo: 415000,
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
  pharmacyId: 'ph_alpha',
  pharmacyName: 'Alpha Pharmacy',
  lines: [
    { productId: 'prod_vitc', pharmacyId: 'ph_alpha', pharmacyName: 'Alpha Pharmacy', name: 'Vitamin C', form: '1000mg · 30 tablets', priceKobo: 180000, qty: 1, rxRequired: false, imageColor: Colors.iconBgGold },
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
    { productId: 'prod_baby', pharmacyId: 'ph_health', pharmacyName: 'HealthPlus Pharmacy', name: 'Infant Multivitamin', form: 'Syrup · 100ml', priceKobo: 145000, qty: 1, rxRequired: false, imageColor: Colors.iconBgTeal },
  ],
  subtotalKobo: 145000,
  deliveryFeeKobo: 120000,
  totalKobo: 145000,
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
  { id: 'rx_verified:0', rxId: 'rx_verified', name: 'Lisinopril 10mg', schedule: '1 tab daily · 30 tablets', status: 'verified', refillsAuthorized: 3, refillsUsed: 1 },
  { id: 'rx_verifying:0', rxId: 'rx_verifying', name: 'Amoxicillin 500mg', schedule: '1 cap, 3x daily · 21 capsules', status: 'verifying', refillsAuthorized: 0, refillsUsed: 0 },
];

// A refill is a prescription with authorized refills left (DP-004) — the same read
// the live endpoint returns, so the fixture carries the same fields.
const MOCK_REFILLS: PrescriptionRefill[] = [
  { rxId: 'rx_verified', drugs: ['Lisinopril 10mg'], refillsAuthorized: 3, refillsUsed: 1, lastDispensedAt: new Date(Date.now() - 86_400_000).toISOString() },
];

const MOCK_REVIEWS: PharmacyReview[] = [
  { id: 'rv_1', author: 'Chidi N.', rating: 5, body: 'Fast delivery and the pharmacist called to confirm dosage. Excellent.', at: new Date(Date.now() - 4 * 86_400_000).toISOString(), orderRef: 'PHX-47990' },
  { id: 'rv_2', author: 'Funke A.', rating: 4, body: 'Good service, packaging was discreet. Delivery was slightly late.', at: new Date(Date.now() - 9 * 86_400_000).toISOString() },
];

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

// pharmacy.Product) onto the richer mobile PharmacyProduct display shape.
// Fields the backend does not (yet) store — brand/form/description/rating/
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
    // category filter still buckets sensibly until the catalog model is enriched.
    category: raw.rx_required ? 'prescription' : 'otc',
    priceKobo: raw.price_kobo ?? 0,
    nafdacReg: raw.nafdac_ref ?? '',
    rxRequired: !!raw.rx_required,
    controlled: !!raw.is_controlled,
    imageColor: tintForId(String(raw.id ?? '')),
    description: raw.description ?? '',
    // The server's own sellable signal. `stock_qty > 0` is NOT availability: 0 means
    // the owner never opted this product into inventory tracking, which the order
    // path treats as unlimited — inferring it here marked sellable products as sold
    // out (see the in_stock comment on the Go Product).
    inStock: raw.in_stock ?? true,
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

// GET /pharmacy/pharmacies — multi-pharmacy discovery (ADR-017). Sorted by
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

// The backend's list route (GET /prescriptions) returns { success, prescriptions }
// where each row is the narrow pharmacy PrescriptionSummary read model — id, state,
// the drug names, both refill counters and reject_reason. Prescriber/pharmacy are
// carried as uuids only, and there is no verified-at timestamp on this read, so the
// names below stay empty and rx-status refetches the single prescription for them.
const RX_STATUS_FROM_STATE: Record<string, RxStatus> = {
  ISSUED: 'issued',
  SENT_TO_PHARMACY: 'verifying',
  VERIFYING: 'verifying',
  VERIFIED: 'verified',
  DISPENSED: 'dispensed',
  FULFILLED: 'dispensed',
  REJECTED: 'rejected',
};
function summaryItems(drugs: unknown): RxItem[] {
  return (Array.isArray(drugs) ? drugs : []).map((d) => ({ name: String(d), dosage: '', quantity: '' }));
}
function mapPrescriptionSummary(raw: any): Prescription {
  return {
    id: raw.id,
    // Every live row here was issued by a prescriber (healthrx) — there is no
    // patient document upload surface, so 'upload' would be a fiction.
    source: 'consult',
    status: RX_STATUS_FROM_STATE[raw.state] ?? 'verifying',
    uploadedAt: raw.created_at,
    pharmacistNote: raw.reject_reason || undefined,
    patientName: '',
    items: summaryItems(raw.drugs),
    docColor: tintForId(String(raw.id ?? '')),
    fulfilled: raw.state === 'DISPENSED' || raw.state === 'FULFILLED',
    refillsAuthorized: raw.refills_authorized ?? 0,
    refillsUsed: raw.refills_used ?? 0,
  };
}

export async function getPrescriptions(): Promise<Prescription[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_PRESCRIPTIONS].sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt));
  }
  const { data } = await api.get<{ prescriptions?: unknown[] }>(`${PHARMACY_API}/prescriptions`);
  return (data.prescriptions ?? []).map(mapPrescriptionSummary);
}

// mapPrescription maps the rx package's flat, uppercase-state Prescription
// (backend/internal/health/rx/service.go) onto the mobile UI's richer shape,
// reusing RX_STATUS_FROM_STATE above. There is no backend concept matching
// RxStatus's 'clarification' (the state machine is a strict VERIFYING ->
// VERIFIED|REJECTED — see decideRx below), so it never appears here.
function mapPrescription(raw: any): Prescription {
  return {
    id: raw.id,
    source: 'consult',
    status: RX_STATUS_FROM_STATE[raw.state] ?? 'verifying',
    uploadedAt: raw.created_at,
    verifiedAt: raw.verified_by ? raw.created_at : undefined,
    pharmacistNote: raw.reject_reason || undefined,
    patientName: '',
    items: (raw.items ?? []).map((it: any) => ({
      name: it.drug_name ?? '',
      dosage: it.dosage ?? '',
      quantity: String(it.quantity ?? ''),
    })),
    docColor: Colors.secondary,
    fulfilled: raw.state === 'DISPENSED' || raw.state === 'FULFILLED',
    refillsAuthorized: raw.refills_authorized ?? 0,
    refillsUsed: raw.refills_used ?? 0,
  };
}

// GET /health/prescriptions/:id — NOT under PHARMACY_API (/health/pharmacy/...):
// this route is owned by the rx package and mounted directly under /health
// (backend/internal/app/health_routes.go), so it used to 404 at
// part of the real path).
export async function getPrescription(id: string): Promise<Prescription> {
  if (USE_MOCK) {
    await delay();
    const rx = MOCK_PRESCRIPTIONS.find((r) => r.id === id);
    if (!rx) throw new Error('Prescription not found');
    return rx;
  }
  const { data } = await api.get<{ prescription?: unknown }>(`${HEALTH_API_BASE}/prescriptions/${id}`);
  if (!data.prescription) throw new Error('Prescription not found');
  return mapPrescription(data.prescription);
}

/**
 * Send one of the patient's own e-prescriptions to a pharmacy for verification
 * (HL-3: ISSUED → SENT_TO_PHARMACY). This is the only Rx action a patient has: a
 * prescription is issued by a licensed prescriber through a consult, and there is no
 * server route that accepts a photographed Rx — no upload endpoint, no storage key
 * and no data-model home for one, so a photo could never reach a pharmacist's queue.
 * `POST /health/prescriptions/:id/send` is owned by the rx package and mounted under
 * /health, not under PHARMACY_API.
 */
export async function sendPrescriptionToPharmacy(rxId: string, pharmacyProviderId: string): Promise<Prescription> {
  if (USE_MOCK) {
    await delay(500);
    const rx = MOCK_PRESCRIPTIONS.find((r) => r.id === rxId);
    if (!rx) throw new Error('Prescription not found');
    rx.status = 'verifying';
    rx.pharmacyName = MOCK_PHARMACIES.find((p) => p.id === pharmacyProviderId)?.name ?? '';
    return { ...rx };
  }
  const { data } = await api.post<{ prescription?: unknown }>(`${HEALTH_API_BASE}/prescriptions/${rxId}/send`, {
    pharmacy_provider_id: pharmacyProviderId,
  });
  if (!data.prescription) throw new Error('Prescription was not sent');
  return mapPrescription(data.prescription);
}

const ORDER_STATUS_FROM_STATE: Record<string, OrderStatus> = {
  CREATED: 'created',
  RX_PENDING_VERIFICATION: 'rx_pending',
  CONFIRMED: 'confirmed',
  DISPENSED: 'dispensed',
  IN_DELIVERY: 'in_delivery',
  READY_FOR_PICKUP: 'ready_for_pickup',
  DELIVERED: 'delivered',
  COLLECTED: 'collected',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
};

// pharmacy.Order/OrderLine) onto the richer mobile PharmacyOrder display
// shape. The backend has no `reference` (falls back to the order id), no
// `subtotalKobo`/`deliveryFeeKobo` split (total_kobo only, so the whole
// amount is attributed to subtotal), no `rider`/`etaLabel`, and lines carry
// no `form`/`imageColor` — those default to empty/derived so the card still
// renders, matching the mapProduct convention above.
// The backend stores only an order's current `state` and its `created_at`; there is
// no per-transition timestamp row. So the progress rail is derived from the state
// machine: earlier steps are marked reached WITHOUT inventing when they happened —
// only "Order placed" carries a real time, the rest show as reached/pending.
const ORDER_RAIL_RANK: Record<string, number> = {
  created: 0,
  rx_pending: 1,
  confirmed: 2,
  dispensed: 3,
  in_delivery: 4,
  ready_for_pickup: 4,
  delivered: 5,
  collected: 5,
};

function deriveTimeline(state: OrderStatus, fulfilment: 'delivery' | 'pickup', requiresRx: boolean, createdAt: string): OrderEvent[] {
  if (state === 'cancelled' || state === 'refunded' || state === 'closed') {
    return [
      { status: 'created', label: 'Order placed · payment held', at: createdAt, done: true },
      {
        status: state,
        label: state === 'cancelled' ? 'Cancelled · held money returned' : 'Refunded · held money returned',
        done: true,
      },
    ];
  }

  const rail: { status: OrderStatus; label: string }[] = [
    { status: 'created', label: 'Order placed · payment held' },
    ...(requiresRx ? [{ status: 'rx_pending' as OrderStatus, label: 'Prescription checked by the pharmacist' }] : []),
    { status: 'confirmed', label: 'Confirmed by pharmacy' },
    { status: 'dispensed', label: 'Dispensed & packed' },
    ...(fulfilment === 'delivery'
      ? [
          { status: 'in_delivery' as OrderStatus, label: 'Out for delivery' },
          { status: 'delivered' as OrderStatus, label: 'Delivered' },
        ]
      : [
          { status: 'ready_for_pickup' as OrderStatus, label: 'Ready for pickup' },
          { status: 'collected' as OrderStatus, label: 'Collected' },
        ]),
  ];

  const rank = ORDER_RAIL_RANK[state] ?? 0;
  return rail.map((step, i) => ({
    status: step.status,
    label: step.label,
    ...(i === 0 ? { at: createdAt } : {}),
    done: (ORDER_RAIL_RANK[step.status] ?? 0) <= rank,
  }));
}

function mapOrder(raw: any): PharmacyOrder {
  const state: OrderStatus = ORDER_STATUS_FROM_STATE[raw.state] ?? 'created';
  const fulfilment = raw.fulfilment_method === 'DELIVERY' ? 'delivery' : 'pickup';
  const requiresRx = !!raw.prescription_id;
  const lines: CartLine[] = (raw.lines ?? []).map((l: any) => ({
    productId: l.product_id,
    // Every line of one order belongs to the order's pharmacy by construction
    // (CreateOrder rejects a product outside its catalog), so the order id carries.
    pharmacyId: raw.pharmacy_provider_id ?? '',
    pharmacyName: '',
    name: l.product_name ?? '',
    form: '',
    priceKobo: l.unit_price_kobo ?? 0,
    qty: l.quantity ?? 0,
    rxRequired: !!l.rx_required,
    imageColor: tintForId(String(l.product_id ?? '')),
  }));
  return {
    id: raw.id,
    reference: raw.id,
    status: state,
    fulfilment,
    pharmacyId: raw.pharmacy_provider_id ?? '',
    pharmacyName: '',
    lines,
    subtotalKobo: raw.total_kobo ?? 0,
    deliveryFeeKobo: 0,
    totalKobo: raw.total_kobo ?? 0,
    paymentHeld: !!raw.escrow_id,
    createdAt: raw.created_at,
    pickupCode: raw.pickup_code ?? undefined,
    deliveryAddress: raw.delivery_address ?? undefined,
    requiresRx,
    rxId: raw.prescription_id ?? undefined,
    timeline: deriveTimeline(state, fulfilment, requiresRx, raw.created_at),
  };
}

// GET /orders/mine — the caller's own order history. NOT GET /orders, which is
// the pharmacist's owner-scoped fulfilment inbox (see Go ListMine) — a patient
// calling that endpoint got an empty list, or another business's orders if
// they also happened to own a pharmacy.
export async function getOrders(): Promise<PharmacyOrder[]> {
  if (USE_MOCK) {
    await delay();
    return [...ORDERS].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  const { data } = await api.get<{ orders?: unknown[] }>(`${PHARMACY_API}/orders/mine`);
  return (data.orders ?? []).map(mapOrder);
}

export async function getOrder(id: string): Promise<PharmacyOrder> {
  if (USE_MOCK) {
    await delay();
    const o = ORDERS.find((x) => x.id === id);
    if (!o) throw new Error('Order not found');
    return o;
  }
  const { data } = await api.get<{ order?: unknown }>(`${PHARMACY_API}/orders/${id}`);
  if (!data.order) throw new Error('Order not found');
  return mapOrder(data.order);
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
      // Goods only, matching what the live CreateOrder holds (see mapOrder).
      totalKobo: subtotalKobo,
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
  // The backend (backend/internal/health/pharmacy/handler.go CreateOrder) binds a
  // snake_case struct with DIFFERENT field names, not just different casing
  // (pharmacy_provider_id, fulfilment_method, lines[].product_id/quantity) — this
  // used to spread `input`'s camelCase fields straight into the body, so every
  // live order-create request bound to an empty pharmacy_provider_id, an empty
  // fulfilment_method, and zero lines. The response is also wrapped in
  // {success, order}, like every other pharmacy endpoint (see mapOrder below),
  // not a raw PharmacyOrder.
  const { data } = await api.post<{ order?: unknown }>(
    `${PHARMACY_API}/orders`,
    {
      pharmacy_provider_id: input.pharmacyId,
      prescription_id: input.rxId ?? null,
      fulfilment_method: input.fulfilment === 'delivery' ? 'DELIVERY' : 'PICKUP',
      idempotency_key: input.idempotencyKey,
      search_event_id: input.searchEventId ?? undefined,
      delivery_address: input.deliveryAddress,
      delivery_lat: input.deliveryLat,
      delivery_lng: input.deliveryLng,
      lines: input.lines.map((l) => ({ product_id: l.productId, quantity: l.qty })),
    },
    { headers: { 'Idempotency-Key': input.idempotencyKey } },
  );
  if (!data.order) throw new Error('Order was not created');
  return mapOrder(data.order);
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

/** The patient's current medicines, derived from their own e-Rx history. There is no
 * /medications route and no adherence or days-of-supply model on the backend, so an
 * honest "my medications" list is exactly this: the drug lines on their prescriptions
 * plus the refill authority (DP-004) still left on each. */
export async function getMedications(): Promise<MedicationItem[]> {
  const rxs = await getPrescriptions();
  if (USE_MOCK) return MOCK_MEDS;
  return rxs.flatMap((rx) =>
    rx.items.map((item, index) => ({
      id: `${rx.id}:${index}`,
      rxId: rx.id,
      name: item.name,
      schedule: [item.dosage, item.quantity].filter(Boolean).join(' · '),
      status: rx.status,
      refillsAuthorized: rx.refillsAuthorized ?? 0,
      refillsUsed: rx.refillsUsed ?? 0,
    })),
  );
}

// GET /pharmacy/refills — the caller's prescriptions that still have authorized
// refills left (DP-004). The counters live on the prescription; a refill is spent by
// the PHARMACIST at the counter (POST /prescriptions/:id/refills/dispense), so there
// is nothing for the patient to "schedule" here — this list is the read that tells
// them whether asking for one is possible at all.
export async function getRefills(): Promise<PrescriptionRefill[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_REFILLS];
  }
  const { data } = await api.get<{ refills?: unknown[] }>(`${PHARMACY_API}/refills`);
  return (data.refills ?? []).map((raw: any) => ({
    rxId: raw.id,
    drugs: Array.isArray(raw.drugs) ? raw.drugs.map(String) : [],
    refillsAuthorized: raw.refills_authorized ?? 0,
    refillsUsed: raw.refills_used ?? 0,
  }));
}

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

// `${PHARMACY_API}/provider/onboarding[/submit]` was never implemented backend
// side — backend/internal/app/health_pharmacy_routes.go has no /provider group
// actually complete. A real, working generic provider-application backend
// already exists (backend/internal/health/providers/*, mounted at
// /api/finance/health/providers/applications*) and explicitly supports
// client. Repointed here instead of building a duplicate pharmacy-specific
// backend.
// Application.State (DRAFT/SUBMITTED/UNDER_REVIEW/NEEDS_INFO/APPROVED/
// SUSPENDED/REJECTED fold into 'needs_info' since this type has no equivalent
// terminal-failure state to route to instead.
// NOT fixed here: the generic API's AddCredential (the licence-document upload)
// requires a real uploaded file's storage_key — this screen only ever collected
// a licence NUMBER as a text field, with no upload step at all, so there is no
// file to attach. The PCN licence number is carried in the returned state for
// credential upload needs a presign endpoint for this module (mirroring
// internal/doctor/presign.go) plus a document-picker step in this screen —
// out of scope for this fix, flagged as a follow-up.
interface ProviderApplicationWire {
  id: string;
  domain: string;
  provider_type: string;
  display_name: string;
  state: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'NEEDS_INFO' | 'APPROVED' | 'SUSPENDED' | 'REJECTED';
  /** The health_providers row created when an admin approves this application.
   *  Absent until then, and it is the id product writes and review reads need. */
  provider_id?: string;
}

function mapApplicationState(state: ProviderApplicationWire['state']): ProviderOnboardingState['status'] {
  switch (state) {
    case 'DRAFT':        return 'draft';
    case 'SUBMITTED':     return 'submitted';
    case 'UNDER_REVIEW':  return 'under_review';
    case 'APPROVED':      return 'approved';
    case 'NEEDS_INFO':
    case 'SUSPENDED':
    case 'REJECTED':
    default:              return 'needs_info';
  }
}

async function findPharmacyApplication(): Promise<ProviderApplicationWire | undefined> {
  const { data } = await api.get<{ applications: ProviderApplicationWire[] }>(`${PROVIDERS_API}/applications`);
  return data.applications?.find((a) => a.domain === 'PHARMACY');
}

export async function getProviderOnboarding(): Promise<ProviderOnboardingState> {
  if (USE_MOCK) {
    await delay();
    return { status: 'under_review', pcnLicenseNo: 'PCN/LA/9921', pcnStatus: 'pending', premisesVerified: false, businessName: 'Wellness Hub Pharmacy' };
  }
  const app = await findPharmacyApplication();
  if (!app) return { status: 'draft', pcnStatus: 'pending', premisesVerified: false };
  return {
    status: mapApplicationState(app.state),
    businessName: app.display_name,
    pcnStatus: 'pending',
    premisesVerified: false,
  };
}

// ever collected the PCN licence NUMBER, with no document-upload step, so
// AddCredential (which requires a real uploaded file's storage_key) could
// never be called. Now optional on this input: when the screen supplies a
// picked file, it's presigned + uploaded to R2 and recorded as a real PCN
// credential before submission.
export async function submitProviderOnboarding(
  input: Partial<ProviderOnboardingState> & { licenceFile?: { uri: string; fileName: string; mimeType: string } },
): Promise<ProviderOnboardingState> {
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
  let app = await findPharmacyApplication();
  if (!app) {
    // provider_type is the BUSINESS entity ('pharmacy'), not the professional role
    // ('pharmacist'): DiscoverPharmacies, GetPharmacy and the admin dashboard all
    // filter health_providers on provider_type='pharmacy', so an application filed
    // as 'pharmacist' produced an approved storefront that no patient could ever see.
    const created = await api.post<{ application: ProviderApplicationWire }>(`${PROVIDERS_API}/applications`, {
      domain: 'PHARMACY', provider_type: 'pharmacy', display_name: input.businessName ?? '',
    });
    app = created.data.application;
  }
  if (input.licenceFile) {
    const storageKey = await uploadProviderCredential(app.id, input.licenceFile);
    await addProviderCredential(app.id, { credType: 'PCN', referenceNo: input.pcnLicenseNo, storageKey });
  }
  // already-submitted application is a 409, so skip the call rather than
  // treat a resubmit as a failure.
  if (app.state === 'DRAFT' || app.state === 'NEEDS_INFO') {
    const submitted = await api.post<{ application: ProviderApplicationWire }>(`${PROVIDERS_API}/applications/${app.id}/submit`, {});
    app = submitted.data.application;
  }
  return {
    status: mapApplicationState(app.state),
    pcnLicenseNo: input.pcnLicenseNo,
    pcnStatus: 'pending',
    premisesVerified: false,
    businessName: app.display_name,
  };
}

const MOCK_CATALOG: CatalogStockItem[] = [
  { productId: 'prod_amox', pharmacyProviderId: 'ph_health', pharmacyName: 'HealthPlus Pharmacy', name: 'Amoxicillin', form: '500mg · 21 capsules', priceKobo: 285000, nafdacReg: 'A4-0123', nafdacStatus: 'REGISTERED', rxRequired: true, stock: 48, inStock: true, active: true },
  { productId: 'prod_lisin', pharmacyProviderId: 'ph_health', pharmacyName: 'HealthPlus Pharmacy', name: 'Lisinopril', form: '10mg · 30 tablets', priceKobo: 420000, nafdacReg: 'A4-7781', nafdacStatus: 'REGISTERED', rxRequired: true, stock: 12, inStock: true, active: true },
  { productId: 'prod_para', pharmacyProviderId: 'ph_health', pharmacyName: 'HealthPlus Pharmacy', name: 'Paracetamol', form: '500mg · 24 tablets', priceKobo: 65000, nafdacReg: 'A4-0991', nafdacStatus: 'REGISTERED', rxRequired: false, stock: 0, inStock: false, active: true },
  { productId: 'prod_vitc', pharmacyProviderId: 'ph_health', pharmacyName: 'HealthPlus Pharmacy', name: 'Vitamin C', form: '1000mg · 30 tablets', priceKobo: 180000, nafdacReg: 'B1-4420', nafdacStatus: 'PENDING', rxRequired: false, stock: 30, inStock: true, active: false },
];

function mapCatalogItem(raw: any): CatalogStockItem {
  return {
    productId: raw.id,
    pharmacyProviderId: raw.pharmacy_provider_id ?? '',
    pharmacyName: raw.pharmacy_name ?? '',
    name: raw.name ?? '',
    form: '',
    priceKobo: raw.price_kobo ?? 0,
    nafdacReg: raw.nafdac_ref ?? '',
    nafdacStatus: raw.nafdac_status ?? '',
    rxRequired: !!raw.rx_required,
    stock: raw.stock_qty ?? 0,
    // The server's own sellable signal. Deliberately NOT stock_qty > 0: an
    // untracked product sits at 0 forever and is still buyable (see the column
    // comment on health/pharmacy's Product).
    inStock: raw.in_stock !== false,
    active: !!raw.active,
  };
}

// GET /products/mine (h.MyProducts) — the real path; /provider/catalog doesn't exist.
export async function getProviderCatalog(): Promise<CatalogStockItem[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_CATALOG];
  }
  const { data } = await api.get<{ products?: unknown[] }>(`${PHARMACY_API}/products/mine`);
  return (data.products ?? []).map(mapCatalogItem);
}

/** Add or edit one line of the pharmacy's shelf. POST /products is an upsert keyed
 *  on `id`, scoped to the verified owner (HL-2) and rejected outright when the
 *  NAFDAC reference is blank or not REGISTERED (HL-5) — those come back as 422
 *  messages from the server and the caller surfaces them verbatim.
 *  `providerId` is the caller's approved health_providers row (see getMyPharmacy). */
export async function upsertProduct(providerId: string, input: UpsertProductInput): Promise<CatalogStockItem> {
  if (USE_MOCK) {
    await delay(400);
    const id = input.id ?? `prod_${Date.now()}`;
    const row: CatalogStockItem = {
      productId: id,
      pharmacyProviderId: providerId,
      pharmacyName: 'HealthPlus Pharmacy',
      name: input.name,
      form: '',
      priceKobo: input.priceKobo,
      nafdacReg: input.nafdacReg,
      nafdacStatus: 'REGISTERED',
      rxRequired: input.rxRequired,
      stock: input.stockQty,
      inStock: input.stockQty > 0,
      active: input.active,
    };
    const existing = MOCK_CATALOG.findIndex((c) => c.productId === id);
    if (existing >= 0) MOCK_CATALOG[existing] = row;
    else MOCK_CATALOG.push(row);
    return row;
  }
  const { data } = await api.post<{ product?: unknown }>(`${PHARMACY_API}/products`, {
    id: input.id,
    pharmacy_provider_id: providerId,
    name: input.name,
    nafdac_ref: input.nafdacReg,
    nafdac_status: 'REGISTERED',
    rx_required: input.rxRequired,
    price_kobo: input.priceKobo,
    stock_qty: input.stockQty,
    active: input.active,
  });
  if (!data.product) throw new Error('Product was not saved');
  return mapCatalogItem(data.product);
}

/** The signed-in user's own pharmacy. Everything a pharmacist can write — listing
 *  a product, reading their reviews — is scoped to the health_providers row that
 *  only exists once an admin has approved their application, so this reports
 *  approval rather than guessing an id. */
export async function getMyPharmacy(): Promise<MyPharmacy> {
  if (USE_MOCK) {
    await delay();
    return { providerId: 'ph_health', businessName: 'HealthPlus Pharmacy', approved: true };
  }
  const app = await findPharmacyApplication();
  if (!app) return { providerId: '', businessName: '', approved: false };
  return {
    providerId: app.provider_id ?? '',
    businessName: app.display_name,
    approved: app.state === 'APPROVED',
  };
}

/** Items on this pharmacy's own shelf that a patient cannot buy right now.
 *  There is no /provider/stock-alerts route and no reorder threshold in the
 *  schema, so this is derived from GET /products/mine — the same rows the
 *  inventory screen shows. */
export async function getStockAlerts(): Promise<StockAlert[]> {
  const shelf = await getProviderCatalog();
  return shelf
    .filter((p) => !p.active || p.nafdacStatus !== 'REGISTERED' || !p.inStock)
    .map((p) => ({
      productId: p.productId,
      name: p.name,
      stock: p.stock,
      reason: !p.active
        ? 'deactivated'
        : p.nafdacStatus !== 'REGISTERED'
          ? 'nafdac_pending'
          : 'sold_out',
    }));
}

// GET /orders (h.ListMine) — the pharmacist's owner-scoped fulfilment inbox.
// NOT /provider/orders (doesn't exist), and NOT /orders/mine (that's the
// PATIENT's own order history — see getOrders above).
export async function getProviderOrders(): Promise<PharmacyOrder[]> {
  if (USE_MOCK) {
    await delay();
    return [...ORDERS];
  }
  const { data } = await api.get<{ orders?: unknown[] }>(`${PHARMACY_API}/orders`);
  return (data.orders ?? []).map(mapOrder);
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
  // Dispatch (backend/internal/health/pharmacy/service.go) handles BOTH
  // fulfilment methods through the ONE endpoint, branching internally on the
  // generates a pickup code) — there is no separate .../ready route, so the
  // 'pickup' mode used to 404 every time.
  const { data } = await api.post<{ order?: unknown }>(`${PHARMACY_API}/orders/${orderId}/dispatch`, {}, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (!data.order) throw new Error('Order not found');
  return mapOrder(data.order);
}

// GET /pharmacy/prescriptions/queue — prescriptions pinned to a pharmacy the caller
// owns, in the states a pharmacist works (SENT_TO_PHARMACY / VERIFYING / VERIFIED).
// The client used to call /provider/rx-queue, which no route ever served, so the
// pharmacist could not see the work the patient's "send" produced.
export async function getProviderRxQueue(): Promise<ProviderRxQueueItem[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_PRESCRIPTIONS.filter((r) => r.status === 'verifying' || r.status === 'clarification').map((r) => ({
      rxId: r.id,
      patientName: r.patientName,
      prescriberName: r.prescriberName,
      uploadedAt: r.uploadedAt,
      itemCount: r.items.length,
      drugs: r.items.map((i) => i.name),
      refillsAuthorized: r.refillsAuthorized ?? 0,
      refillsUsed: r.refillsUsed ?? 0,
      status: r.status,
    }));
  }
  const { data } = await api.get<{ prescriptions?: unknown[] }>(`${PHARMACY_API}/prescriptions/queue`);
  return (data.prescriptions ?? []).map((raw: any) => ({
    rxId: raw.id,
    patientName: raw.patient_name ?? '',
    uploadedAt: raw.updated_at ?? raw.created_at,
    itemCount: raw.item_count ?? 0,
    drugs: Array.isArray(raw.drugs) ? raw.drugs.map(String) : [],
    refillsAuthorized: raw.refills_authorized ?? 0,
    refillsUsed: raw.refills_used ?? 0,
    status: RX_STATUS_FROM_STATE[raw.state] ?? 'verifying',
  }));
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
  // The backend (VerifyPrescription, backend/internal/health/pharmacy/handler.go)
  // binds {begin, approve, reason} — a two-state VERIFIED|REJECTED decision, not
  // the {decision, note} shape this used to send (which bound to zero values,
  // silently defaulting every call to "reject" with no reason). There is no
  // backend equivalent of 'clarify' (rx/service.go's state machine only has
  // VERIFYING -> VERIFIED|REJECTED) — mapping it to reject would misrecord a
  // "please clarify" as an actual rejection, so it fails closed instead of
  // fabricating that outcome. `begin: true` is always safe to send: the
  // transition helper treats re-entering the current state as an idempotent
  // no-op (rx/service.go transition()), so this works whether or not a
  // separate BeginVerify call already happened.
  if (decision === 'clarify') {
    throw new Error('Requesting clarification is not supported yet — approve or reject this prescription.');
  }
  await api.post(`${PHARMACY_API}/prescriptions/${rxId}/verify`, {
    begin: true,
    approve: decision === 'approve',
    reason: note ?? '',
  });
  return getPrescription(rxId);
}

/**
 * Dispense one authorized refill (DP-004) — the pharmacist's action at the counter.
 * POST /health/prescriptions/:id/refills/dispense; the server refuses (409) once
 * refills_used reaches refills_authorized, so a patient can never be promised a
 * refill the prescriber did not write.
 */
export async function dispenseRefill(rxId: string): Promise<Prescription> {
  if (USE_MOCK) {
    await delay(450);
    const rx = MOCK_PRESCRIPTIONS.find((r) => r.id === rxId);
    if (!rx) throw new Error('Prescription not found');
    if ((rx.refillsUsed ?? 0) >= (rx.refillsAuthorized ?? 0)) throw new Error('No authorized refills left');
    rx.refillsUsed = (rx.refillsUsed ?? 0) + 1;
    return { ...rx };
  }
  const { data } = await api.post<{ prescription?: unknown }>(
    `${HEALTH_API_BASE}/prescriptions/${rxId}/refills/dispense`,
    {},
  );
  if (!data.prescription) throw new Error('Refill dispense returned no prescription');
  return mapPrescription(data.prescription);
}

export async function getProviderEarnings(): Promise<ProviderEarnings> {
  if (USE_MOCK) {
    await delay();
    return { availableKobo: 1845000, pendingKobo: 670000, ordersPaid: 128 };
  }
  // The backend's earnings read model is three flat totals plus a count
  // (released_kobo, held_kobo, orders_paid — backend/internal/health/pharmacy/model.go).
  // There is no per-payout or per-settlement breakdown to list, because release is
  // automatic on order completion and no payout-request ledger exists.
  const { data } = await api.get<{ earnings?: { released_kobo?: number; held_kobo?: number; orders_paid?: number } }>(
    `${PHARMACY_API}/earnings`,
  );
  const e = data.earnings ?? {};
  return {
    availableKobo: e.released_kobo ?? 0,
    pendingKobo: e.held_kobo ?? 0,
    ordersPaid: e.orders_paid ?? 0,
  };
}
