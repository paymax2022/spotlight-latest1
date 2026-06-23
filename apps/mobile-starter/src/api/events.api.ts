import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { Event } from '@/types/fintech';

// ─── Extended types for Premium Event Suite ─────────────────────────────────

export interface EventDetail extends Event {
  description: string;
  about: string;
  artists: Artist[];
  faqs: FAQ[];
  tags: string[];
  image_urls: string[];
  organizer_verified: boolean;
}

export interface Artist {
  id: string;
  name: string;
  image_url: string;
  genre: string;
}

export interface FAQ {
  question: string;
  answer: string;
}

export interface TicketTier {
  id: string;
  name: string;
  price_kobo: number;
  available: number;
  total: number;
  description: string;
  perks: string[];
  is_popular: boolean;
}

export interface MyTicket {
  id: string;
  event_id: string;
  event_title: string;
  event_image_url: string;
  date: string;
  time: string;
  venue: string;
  tier_name: string;
  seat: string;
  gate: string;
  qr_code: string;
  status: 'valid' | 'used' | 'cancelled' | 'expired';
  is_vip: boolean;
  price_kobo: number;
}

// ─── API calls ───────────────────────────────────────────────────────────────

export async function listEvents(params?: {
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<Event[]> {
  const response = await api.get('/api/v1/events', { params });
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.events ?? [];
}

export async function getEvent(id: string): Promise<EventDetail> {
  const response = await api.get(`/api/v1/events/${id}`);
  return response.data?.data ?? response.data;
}

export async function listEventTicketTiers(eventId: string): Promise<TicketTier[]> {
  const response = await api.get(`/api/v1/events/${eventId}/tiers`);
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.tiers ?? [];
}

export async function purchaseTickets(payload: {
  event_id: string;
  selections: { tier_id: string; quantity: number }[];
}): Promise<{ order_id: string; reference: string; amount_kobo: number; tickets: MyTicket[] }> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post('/api/v1/events/tickets', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data?.data ?? response.data;
}

export async function listMyTickets(filter?: 'upcoming' | 'past'): Promise<MyTicket[]> {
  const params = filter ? { filter } : undefined;
  const response = await api.get('/api/v1/events/my-tickets', { params });
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.tickets ?? [];
}

export async function transferTicket(payload: {
  ticket_id: string;
  recipient_phone: string;
}): Promise<void> {
  const idempotencyKey = generateIdempotencyKey();
  await api.post(`/api/v1/events/tickets/${payload.ticket_id}/transfer`, payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
