// ── Paymax Stays (SM2) — Agent-assisted booking data layer ───────────────────
// Self-contained, mock-first. ADDS to SM1; never edits SM1's owned files.
//
// PRD §20: the agent acts on the CUSTOMER's identity — the booking always lives
// on the customer's account, never the agent's. Payment is collected as
// cash → agent float → customer wallet, OR a pay-link the customer settles.
// Confirm/book follow the same prebook→book confirmation guarantee and carry an
// Idempotency-Key (money-path). Also powers the traveller-context handoff (§17 H).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import {
  STAYS_API_BASE,
  USE_MOCK,
  MOCK_DELAY_MS,
  newIdempotencyKey,
  nightsBetween,
} from './constants/stays.constants';
import type { Currency, GuestConfig, PropertyCard } from './types';

const delay = (ms = MOCK_DELAY_MS) => new Promise((r) => setTimeout(r, ms));
const KEY = 'stays';

// Backend wraps every response body in { data: ... }.
function unwrap<T>(body: any): T {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

// ── Live backend agent channel (mounted under /api/finance/stays/agent) ───────
// POST /agent/quote · POST /agent/book · GET /agent/bookings · GET /agent/commissions
const AGENT_API_BASE = `${STAYS_API_BASE}/agent`;

// Backend quote shape (POST /agent/quote → { data: BEAgentQuote }).
interface BEAgentQuote {
  reservation_id: string;
  book_token: string;
  customer_name: string;
  property_id: string;
  check_in: string;
  check_out: string;
  currency: string;
  gross_kobo: number;
  tax_kobo: number;
  net_rate_kobo: number;
  commission_kobo: number;
}

// Backend reservation shape (subset used by the agent surface).
interface BEAgentReservation {
  id: string;
  supplier_ref?: string;
  property_id: string;
  customer_name?: string;
  customer_contact?: string;
  check_in: string;
  check_out: string;
  currency: string;
  gross_amount_kobo: number;
  commission_kobo: number;
  state: string;
  created_at: string;
  content?: { name?: string; city?: string; cover_url?: string } | null;
}

// Backend commission totals (GET /agent/commissions → { data: BEAgentCommission }).
interface BEAgentCommission {
  bookings_count: number;
  gross_sales_kobo: number;
  commission_kobo: number;
}

function mapBEReservationToBooking(r: BEAgentReservation): AgentBooking {
  return {
    id: r.id,
    reference: r.supplier_ref ?? r.id,
    customerName: r.customer_name ?? '',
    customerId: '', // walk-in: no separate customer account id
    propertyName: r.content?.name ?? '',
    city: r.content?.city ?? '',
    checkIn: (r.check_in ?? '').slice(0, 10),
    checkOut: (r.check_out ?? '').slice(0, 10),
    totalKobo: r.gross_amount_kobo ?? 0,
    currency: (r.currency ?? 'NGN') as Currency,
    commissionKobo: r.commission_kobo ?? 0,
    status: r.state?.startsWith('CANCELLED') || r.state === 'VOID' ? 'CANCELLED' : 'CONFIRMED',
    createdAt: r.created_at ?? '',
  };
}

// ── Types ──────────────────────────────────────────────────────────────────--
export interface Customer {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  kycTier: number;
  walletKobo: number;
  city: string;
}

export interface AgentSearchInput {
  customerId: string;
  destination: string;
  checkIn: string;
  checkOut: string;
  guests: GuestConfig;
}

export interface AgentQuoteInput {
  customerId: string;
  propertyId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  guests: GuestConfig;
}

export interface AgentQuote {
  quoteId: string;
  customerId: string;
  propertyId: string;
  propertyName: string;
  coverUrl: string;
  city: string;
  roomTypeName: string;
  ratePlanName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: GuestConfig;
  totalKobo: number;
  currency: Currency;
  commissionKobo: number;
  /** TTL for the held quote. */
  expiresAt: string;
}

export type CollectMethod = 'cash_float' | 'pay_link' | 'customer_wallet';

export interface CollectInput {
  quoteId: string;
  method: CollectMethod;
}

export interface CollectResult {
  ok: boolean;
  method: CollectMethod;
  /** For pay_link: the link the customer settles. */
  payLink?: string;
  /** Funds now available on the customer's wallet (cash → float → wallet). */
  fundedKobo?: number;
}

export interface AgentBooking {
  id: string;
  reference: string;
  customerName: string;
  customerId: string;
  propertyName: string;
  city: string;
  checkIn: string;
  checkOut: string;
  totalKobo: number;
  currency: Currency;
  commissionKobo: number;
  status: 'CONFIRMED' | 'CANCELLED';
  createdAt: string;
}

export interface AgentCommissionSummary {
  monthLabel: string;
  bookingsCount: number;
  grossSalesKobo: number;
  commissionKobo: number;
  paidKobo: number;
  pendingKobo: number;
  floatBalanceKobo: number;
}

// ── Mock data ────────────────────────────────────────────────────────────────
const MOCK_CUSTOMERS: Customer[] = [
  { id: 'cust_1', fullName: 'Bola Adeyemi', phone: '+2348022223333', email: 'bola.a@example.com', kycTier: 2, walletKobo: 5_000_000, city: 'Lagos' },
  { id: 'cust_2', fullName: 'Emeka Nwosu', phone: '+2348144445555', email: 'emeka.n@example.com', kycTier: 1, walletKobo: 0, city: 'Enugu' },
  { id: 'cust_3', fullName: 'Fatima Bello', phone: '+2349066667777', email: 'fatima.b@example.com', kycTier: 3, walletKobo: 32_000_000, city: 'Abuja' },
];

const MOCK_AGENT_PROPERTIES: PropertyCard[] = [
  {
    id: 'stay_lag_eko', name: 'Eko Signature Hotel', city: 'Lagos', area: 'Victoria Island', star: 5,
    propertyType: 'hotel', sourceRail: 'DIRECT', coverUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945',
    leadPriceMinor: 9_500_000, currency: 'NGN', reviewScore: 9.1, reviewCount: 1240, freeCancellation: true,
    amenities: ['wifi', 'pool', 'ac', 'breakfast'], geo: { lat: 6.4281, lng: 3.4219 }, soldOut: false, distanceKm: 2.1,
  },
  {
    id: 'stay_abj_hilton', name: 'Transcorp Hilton Abuja', city: 'Abuja', area: 'Maitama', star: 5,
    propertyType: 'hotel', sourceRail: 'BEDBANK', coverUrl: 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa',
    leadPriceMinor: 9_600_000, currency: 'NGN', reviewScore: 8.7, reviewCount: 980, freeCancellation: false,
    amenities: ['wifi', 'gym', 'ac', 'restaurant'], geo: { lat: 9.0765, lng: 7.4983 }, soldOut: false, distanceKm: 4.4,
  },
  {
    id: 'stay_lag_george', name: 'The George Lagos', city: 'Lagos', area: 'Ikoyi', star: 5,
    propertyType: 'hotel', sourceRail: 'DIRECT', coverUrl: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b',
    leadPriceMinor: 14_000_000, currency: 'NGN', reviewScore: 9.3, reviewCount: 760, freeCancellation: true,
    amenities: ['wifi', 'pool', 'ac', 'breakfast', 'gym'], geo: { lat: 6.4498, lng: 3.4361 }, soldOut: false, distanceKm: 3.0,
  },
];

const quotes = new Map<string, AgentQuote>();
// Live: the supplier book_token returned by /agent/quote, keyed by reservation id
// (the quoteId). Book passes it back to /agent/book.
const bookTokens = new Map<string, string>();
const agentBookings: AgentBooking[] = [
  {
    id: 'ab_1', reference: 'PMX-AG3KQ9', customerName: 'Fatima Bello', customerId: 'cust_3',
    propertyName: 'Transcorp Hilton Abuja', city: 'Abuja', checkIn: isoDays(-12), checkOut: isoDays(-10),
    totalKobo: 19_200_000, currency: 'NGN', commissionKobo: 1_536_000, status: 'CONFIRMED', createdAt: isoTs(-12),
  },
];

function isoDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function isoTs(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

const COMMISSION_PCT = 0.08;

// ── API ──────────────────────────────────────────────────────────────────────
export async function lookupCustomers(q: string): Promise<Customer[]> {
  if (USE_MOCK) {
    await delay(220);
    const needle = q.trim().toLowerCase();
    if (!needle) return MOCK_CUSTOMERS;
    return MOCK_CUSTOMERS.filter(
      (c) => c.fullName.toLowerCase().includes(needle) || c.phone.includes(needle) || c.email.toLowerCase().includes(needle),
    );
  }
  // TODO(stays): agent-assisted flow has no backend
  return [];
}

export async function getCustomer(id: string): Promise<Customer> {
  if (USE_MOCK) {
    await delay(140);
    const c = MOCK_CUSTOMERS.find((x) => x.id === id);
    if (!c) throw new Error('Customer not found');
    return c;
  }
  // TODO(stays): agent-assisted flow has no backend
  return { id, fullName: '', phone: '', email: '', kycTier: 0, walletKobo: 0, city: '' };
}

export async function agentSearch(input: AgentSearchInput): Promise<PropertyCard[]> {
  if (USE_MOCK) {
    await delay();
    const dest = input.destination.trim().toLowerCase();
    if (!dest) return MOCK_AGENT_PROPERTIES;
    return MOCK_AGENT_PROPERTIES.filter(
      (p) => p.city.toLowerCase().includes(dest) || p.area.toLowerCase().includes(dest) || p.name.toLowerCase().includes(dest),
    );
  }
  // TODO(stays): agent-assisted flow has no backend
  return [];
}

export async function getAgentProperty(id: string): Promise<PropertyCard> {
  if (USE_MOCK) {
    await delay(160);
    const p = MOCK_AGENT_PROPERTIES.find((x) => x.id === id);
    if (!p) throw new Error('Property not found');
    return p;
  }
  // TODO(stays): agent-assisted flow has no backend
  return {
    id,
    name: '',
    city: '',
    area: '',
    star: 0,
    propertyType: 'hotel',
    sourceRail: 'DIRECT',
    coverUrl: '',
    leadPriceMinor: 0,
    currency: 'NGN',
    reviewScore: 0,
    reviewCount: 0,
    freeCancellation: false,
    amenities: [],
    geo: { lat: 0, lng: 0 },
    soldOut: false,
  };
}

/** Build a held quote on the customer's behalf (prebook-equivalent). */
export async function buildQuote(input: AgentQuoteInput): Promise<AgentQuote> {
  if (USE_MOCK) {
    await delay(700);
    const p = MOCK_AGENT_PROPERTIES.find((x) => x.id === input.propertyId);
    if (!p) throw new Error('Property not found');
    const nights = nightsBetween(input.checkIn, input.checkOut);
    const room = p.leadPriceMinor * nights;
    const taxes = Math.round(room * 0.125);
    const total = room + taxes;
    const quote: AgentQuote = {
      quoteId: `q_${Math.random().toString(36).slice(2, 9)}`,
      customerId: input.customerId,
      propertyId: p.id,
      propertyName: p.name,
      coverUrl: p.coverUrl,
      city: p.city,
      roomTypeName: 'Deluxe Room',
      ratePlanName: p.freeCancellation ? 'Flexible · Breakfast' : 'Non-refundable · Room only',
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      nights,
      guests: input.guests,
      totalKobo: total,
      currency: p.currency,
      commissionKobo: Math.round(total * COMMISSION_PCT),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
    quotes.set(quote.quoteId, quote);
    return quote;
  }
  // Live: search + priced hold on the customer's behalf (reservation prebook saga).
  // The walk-in customer name/contact are echoed back and captured at book time.
  const { data } = await api.post(
    `${AGENT_API_BASE}/quote`,
    {
      customer_name: input.customerId, // caller supplies the customer name via lookup; id doubles as label for walk-ins
      customer_contact: '',
      // Direct own-supply rail: property_id doubles as the supplier property ref.
      rail: 'DIRECT',
      supplier_code: 'DIRECT',
      property_id: input.propertyId,
      room_type_id: input.propertyId,
      rate_plan_id: input.ratePlanId,
      supplier_property_ref: input.propertyId,
      supplier_rate_plan_ref: input.ratePlanId,
      check_in: input.checkIn,
      check_out: input.checkOut,
      rooms: input.guests.rooms ?? 1,
      occupancy: {
        adults: input.guests.adults,
        children: input.guests.children,
        childrenAges: input.guests.childrenAges,
      },
      currency: 'NGN',
      payment_method: 'WALLET',
    },
  );
  const be = unwrap<BEAgentQuote>(data);
  const q: AgentQuote = {
    quoteId: be.reservation_id, // reservation id doubles as the hold reference → Book
    customerId: input.customerId,
    propertyId: be.property_id,
    propertyName: '',
    coverUrl: '',
    city: '',
    roomTypeName: '',
    ratePlanName: '',
    checkIn: be.check_in ?? input.checkIn,
    checkOut: be.check_out ?? input.checkOut,
    nights: nightsBetween(input.checkIn, input.checkOut),
    guests: input.guests,
    totalKobo: be.gross_kobo ?? 0,
    currency: (be.currency ?? 'NGN') as Currency,
    commissionKobo: be.commission_kobo ?? 0,
    // Backend hold TTL is enforced server-side; mirror a conservative client TTL.
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  // Cache the book_token alongside the quote so Book can pass it (kept client-side).
  quotes.set(q.quoteId, q);
  bookTokens.set(q.quoteId, be.book_token);
  return q;
}

export async function getQuote(quoteId: string): Promise<AgentQuote> {
  if (USE_MOCK) {
    await delay(120);
    const q = quotes.get(quoteId);
    if (!q) throw new Error('Quote expired');
    return q;
  }
  // Live: the quote is a short-lived hold cached client-side after buildQuote
  // (the backend has no GET /agent/quote/:id — the hold lives on the reservation).
  const cached = quotes.get(quoteId);
  if (!cached) throw new Error('Quote expired — please re-quote.');
  return cached;
}

/** Collect payment: cash→float→wallet, send a pay-link, or charge wallet. */
export async function collectPayment(input: CollectInput): Promise<CollectResult> {
  if (USE_MOCK) {
    await delay(700);
    const q = quotes.get(input.quoteId);
    if (!q) throw new Error('Quote expired');
    if (input.method === 'pay_link') {
      return { ok: true, method: 'pay_link', payLink: `https://pay.paymax.ng/q/${q.quoteId}` };
    }
    // cash → agent float → customer wallet (or direct wallet charge).
    return { ok: true, method: input.method, fundedKobo: q.totalKobo };
  }
  // TODO(stays): agent-assisted flow has no backend (money-path — never fabricate success)
  throw new Error('Agent-assisted booking is not available yet.');
}

/** Confirm/book on the customer's behalf (prebook→book confirmation guarantee). */
export async function agentBook(quoteId: string): Promise<AgentBooking> {
  if (USE_MOCK) {
    await delay(1100);
    const q = quotes.get(quoteId);
    if (!q) throw new Error('Quote expired');
    const customer = MOCK_CUSTOMERS.find((c) => c.id === q.customerId);
    const booking: AgentBooking = {
      id: `ab_${Math.random().toString(36).slice(2, 7)}`,
      reference: `PMX-AG${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      customerName: customer?.fullName ?? 'Customer',
      customerId: q.customerId,
      propertyName: q.propertyName,
      city: q.city,
      checkIn: q.checkIn,
      checkOut: q.checkOut,
      totalKobo: q.totalKobo,
      currency: q.currency,
      commissionKobo: q.commissionKobo,
      status: 'CONFIRMED',
      createdAt: new Date().toISOString(),
    };
    agentBookings.unshift(booking);
    quotes.delete(quoteId);
    return booking;
  }
  // Live: book the held quote on the customer's behalf — SAME reservation.Book
  // saga (escrow→settle). Idempotency-Key REQUIRED (money-path).
  const q = quotes.get(quoteId);
  const bookToken = bookTokens.get(quoteId);
  if (!q || !bookToken) throw new Error('Quote expired — please re-quote.');
  // Derive a lead-guest from the captured walk-in customer name (agent channel:
  // the booking carries the customer's identity, not the agent's).
  const parts = (q.customerId || 'Walk-in Customer').trim().split(/\s+/);
  const firstName = parts[0] || 'Walk-in';
  const lastName = parts.slice(1).join(' ') || 'Customer';
  const { data } = await api.post(
    `${AGENT_API_BASE}/book`,
    {
      reservation_id: q.quoteId,
      book_token: bookToken,
      customer_name: q.customerId,
      customer_contact: '',
      guest: { first_name: firstName, last_name: lastName, email: 'walkin@paymax.ng', phone: '' },
    },
    { headers: { 'Idempotency-Key': newIdempotencyKey() } },
  );
  const r = mapBEReservationToBooking(unwrap<BEAgentReservation>(data));
  quotes.delete(quoteId);
  bookTokens.delete(quoteId);
  return r;
}

export async function listAgentBookings(): Promise<AgentBooking[]> {
  if (USE_MOCK) {
    await delay(200);
    return [...agentBookings];
  }
  // Live: reservations this agent booked (filtered by agent_user_id server-side).
  const { data } = await api.get(`${AGENT_API_BASE}/bookings`, {
    params: { limit: 100, offset: 0 },
  });
  const rows = unwrap<BEAgentReservation[]>(data) ?? [];
  return rows.map(mapBEReservationToBooking);
}

export async function getAgentBooking(id: string): Promise<AgentBooking> {
  if (USE_MOCK) {
    await delay(140);
    const b = agentBookings.find((x) => x.id === id);
    if (!b) throw new Error('Booking not found');
    return b;
  }
  // TODO(stays): agent-assisted flow has no backend
  return {
    id,
    reference: '',
    customerName: '',
    customerId: '',
    propertyName: '',
    city: '',
    checkIn: '',
    checkOut: '',
    totalKobo: 0,
    currency: 'NGN',
    commissionKobo: 0,
    status: 'CANCELLED',
    createdAt: new Date().toISOString(),
  };
}

export async function agentCancel(id: string): Promise<AgentBooking> {
  if (USE_MOCK) {
    await delay(800);
    const b = agentBookings.find((x) => x.id === id);
    if (!b) throw new Error('Booking not found');
    b.status = 'CANCELLED';
    return { ...b };
  }
  // TODO(stays): agent-assisted flow has no backend (money-path — never fabricate success)
  throw new Error('Agent-assisted booking is not available yet.');
}

export async function getCommissionSummary(): Promise<AgentCommissionSummary> {
  if (USE_MOCK) {
    await delay(220);
    const confirmed = agentBookings.filter((b) => b.status === 'CONFIRMED');
    const gross = confirmed.reduce((s, b) => s + b.totalKobo, 0);
    const commission = confirmed.reduce((s, b) => s + b.commissionKobo, 0);
    return {
      monthLabel: new Date().toLocaleDateString('en-NG', { month: 'long', year: 'numeric' }),
      bookingsCount: confirmed.length,
      grossSalesKobo: gross,
      commissionKobo: commission,
      paidKobo: Math.round(commission * 0.6),
      pendingKobo: commission - Math.round(commission * 0.6),
      floatBalanceKobo: 12_500_000,
    };
  }
  // Live: agent commission totals across booked+settled reservations.
  const { data } = await api.get(`${AGENT_API_BASE}/commissions`);
  const be = unwrap<BEAgentCommission>(data);
  return {
    monthLabel: new Date().toLocaleDateString('en-NG', { month: 'long', year: 'numeric' }),
    bookingsCount: be.bookings_count ?? 0,
    grossSalesKobo: be.gross_sales_kobo ?? 0,
    commissionKobo: be.commission_kobo ?? 0,
    // Backend does not yet split paid/pending/float; surface the full commission
    // as pending and leave float unknown (0) rather than fabricating a payout state.
    paidKobo: 0,
    pendingKobo: be.commission_kobo ?? 0,
    floatBalanceKobo: 0,
  };
}

// ── Hooks ──────────────────────────────────────────────────────────────────--
export function useCustomerLookup(q: string) {
  return useQuery({ queryKey: [KEY, 'agent', 'customers', q], queryFn: () => lookupCustomers(q), staleTime: 30_000 });
}
export function useCustomer(id: string) {
  return useQuery({ queryKey: [KEY, 'agent', 'customer', id], queryFn: () => getCustomer(id), enabled: !!id });
}
export function useAgentSearch(input: AgentSearchInput, enabled = true) {
  return useQuery({
    queryKey: [KEY, 'agent', 'search', input],
    queryFn: () => agentSearch(input),
    enabled: enabled && !!input.customerId,
    staleTime: 15_000,
  });
}
export function useAgentProperty(id: string) {
  return useQuery({ queryKey: [KEY, 'agent', 'property', id], queryFn: () => getAgentProperty(id), enabled: !!id });
}
export function useBuildQuote() {
  return useMutation({ mutationFn: (input: AgentQuoteInput) => buildQuote(input) });
}
export function useQuote(quoteId: string) {
  return useQuery({ queryKey: [KEY, 'agent', 'quote', quoteId], queryFn: () => getQuote(quoteId), enabled: !!quoteId });
}
export function useCollectPayment() {
  return useMutation({ mutationFn: (input: CollectInput) => collectPayment(input) });
}
export function useAgentBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quoteId: string) => agentBook(quoteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'agent', 'bookings'] });
      qc.invalidateQueries({ queryKey: [KEY, 'agent', 'commission'] });
    },
  });
}
export function useAgentBookings() {
  return useQuery({ queryKey: [KEY, 'agent', 'bookings'], queryFn: listAgentBookings, staleTime: 15_000 });
}
export function useAgentBooking(id: string) {
  return useQuery({ queryKey: [KEY, 'agent', 'booking', id], queryFn: () => getAgentBooking(id), enabled: !!id });
}
export function useAgentCancel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => agentCancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'agent', 'bookings'] }),
  });
}
export function useCommissionSummary() {
  return useQuery({ queryKey: [KEY, 'agent', 'commission'], queryFn: getCommissionSummary, staleTime: 30_000 });
}
