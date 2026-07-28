// ── Spotlight Realtor — Shortlet booking data layer (V3) ─────────────────────
// Short-stay offering mode. Mock-flagged. Availability is transaction-safe in
// spirit: a confirmed booking blocks its nights (enforced server-side in prod).

import { createSupabaseClient } from '@/lib/supabase';
import { REALTOR_USE_MOCK } from './realtorEnv';
import { MOCK_LISTINGS } from './realtor.mock';
import { newIdempotencyKey } from '../utils/realtorFormatters';
import type { Kobo } from '../types/realtor.types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ShortletQuote {
  listingId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  nightly: Kobo;
  cleaningFee: Kobo;
  securityDeposit: Kobo;   // refundable, escrow
  subtotal: Kobo;
  total: Kobo;             // subtotal + cleaning + deposit
}

export type ShortletBookingStatus = 'pending_payment' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';

export interface ShortletBooking {
  id: string;
  listingId: string;
  listingTitle: string;
  coverUrl: string;
  area: string;
  city: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  total: Kobo;
  securityDeposit: Kobo;
  status: ShortletBookingStatus;
  accessCode: string;
  checkInInstructions: string;
  createdAt: string;
}

export interface ShortletBookingDraft {
  listingId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  guestName: string;
  guestPhone: string;
}

const USE_MOCK = REALTOR_USE_MOCK;
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const bookings: Record<string, ShortletBooking> = {};

function mapBookingRow(row: any): ShortletBooking {
  return {
    id: row.id,
    listingId: row.listing_id,
    listingTitle: row.listing_title ?? 'Shortlet',
    coverUrl: row.cover_url ?? '',
    area: row.area ?? '',
    city: row.city ?? '',
    checkIn: row.check_in,
    checkOut: row.check_out,
    nights: Number(row.nights),
    guests: Number(row.guests),
    total: Number(row.total_kobo),
    securityDeposit: Number(row.security_deposit_kobo),
    status: row.status,
    accessCode: row.access_code ?? '',
    checkInInstructions: row.check_in_instructions ?? '',
    createdAt: row.created_at,
  };
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

export async function quoteShortlet(listingId: string, checkIn: string, checkOut: string, guests: number): Promise<ShortletQuote> {
  if (USE_MOCK) {
    await delay(220);
    const listing = MOCK_LISTINGS.find((l) => l.id === listingId);
    const nightly = listing?.nightlyPrice ?? 80_000_00;
    const cleaningFee = 25_000_00;
    const securityDeposit = listing?.cautionDeposit ?? 150_000_00;
    const nights = nightsBetween(checkIn, checkOut);
    const subtotal = nightly * nights;
    return {
      listingId, checkIn, checkOut, nights, guests,
      nightly, cleaningFee, securityDeposit,
      subtotal, total: subtotal + cleaningFee + securityDeposit,
    };
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_listings')
    .select('nightly_kobo, caution_kobo').eq('id', listingId).maybeSingle();
  if (error) throw error;
  const nightly = Number(data?.nightly_kobo ?? 80_000_00);
  const cleaningFee = 25_000_00;
  const securityDeposit = Number(data?.caution_kobo ?? 150_000_00);
  const nights = nightsBetween(checkIn, checkOut);
  const subtotal = nightly * nights;
  return { listingId, checkIn, checkOut, nights, guests, nightly, cleaningFee, securityDeposit, subtotal, total: subtotal + cleaningFee + securityDeposit };
}

export async function createShortletBooking(draft: ShortletBookingDraft): Promise<ShortletBooking> {
  if (USE_MOCK) {
    await delay(640);
    const listing = MOCK_LISTINGS.find((l) => l.id === draft.listingId);
    const q = await quoteShortlet(draft.listingId, draft.checkIn, draft.checkOut, draft.guests);
    const id = `sb_${Date.now().toString(36)}`;
    const booking: ShortletBooking = {
      id,
      listingId: draft.listingId,
      listingTitle: listing?.title ?? 'Shortlet',
      coverUrl: listing?.media[0] ?? '',
      area: listing?.area ?? '',
      city: listing?.city ?? '',
      checkIn: draft.checkIn,
      checkOut: draft.checkOut,
      nights: q.nights,
      guests: draft.guests,
      total: q.total,
      securityDeposit: q.securityDeposit,
      status: 'confirmed',
      accessCode: String(Math.floor(1000 + Math.random() * 9000)),
      checkInInstructions: 'Self check-in from 3:00 PM. Use the access code on the smart lock at the main door. Wi-Fi details are on the fridge.',
      createdAt: new Date().toISOString(),
    };
    bookings[id] = booking;
    return booking;
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.rpc('realtor_create_shortlet_booking', {
    p_listing_id: draft.listingId, p_check_in: draft.checkIn, p_check_out: draft.checkOut,
    p_guests: draft.guests, p_guest_name: draft.guestName, p_guest_phone: draft.guestPhone,
    p_client_ref: newIdempotencyKey(),
  });
  if (error) {
    // The DB exclusion constraint surfaces as 'dates_unavailable'.
    if (String(error.message).includes('dates_unavailable')) throw new Error('Those dates are no longer available.');
    throw error;
  }
  return mapBookingRow(data);
}

export async function getShortletBooking(id: string): Promise<ShortletBooking> {
  if (USE_MOCK) {
    await delay(200);
    const b = bookings[id];
    if (!b) throw new Error('Booking not found');
    return b;
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from('realtor_shortlet_bookings')
    .select(`*, listing:realtor_listings!listing_id(title, media)`).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Booking not found');
  return mapBookingRow({
    ...data,
    listing_title: (data as any).listing?.title,
    cover_url: Array.isArray((data as any).listing?.media) ? (data as any).listing.media[0] : '',
  });
}
