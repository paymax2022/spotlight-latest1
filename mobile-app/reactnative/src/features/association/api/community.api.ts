// ── Association — Committees & Events API wrapper ─────────────────────────────

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK, ASSOCIATION_API_BASE as BASE } from '../constants/association.constants';
import type {
  Committee, CommitteeSummary, Event, EventSummary, EventRsvp, EventRegistrationResult,
} from '../types/community.types';
import { MOCK_COMMITTEES, MOCK_EVENTS } from './community.mock';

const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// ─── Committees ───────────────────────────────────────────────────────────────

const toCommitteeSummary = (c: Committee): CommitteeSummary => {
  const { id, name, purpose, memberCount, joinStatus, myRole } = c;
  return { id, name, purpose, memberCount, joinStatus, myRole };
};

export async function getCommittees(): Promise<CommitteeSummary[]> {
  if (USE_MOCK) { await delay(); return MOCK_COMMITTEES.map(toCommitteeSummary); }
  const { data } = await api.get(`${BASE}/committees`);
  return data;
}

export async function getCommittee(id: string): Promise<Committee> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_COMMITTEES.find((c) => c.id === id);
    if (!found) throw new Error('Committee not found');
    return found;
  }
  const { data } = await api.get(`${BASE}/committees/${id}`);
  return data;
}

export async function requestJoinCommittee(id: string): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  const { data } = await api.post(`${BASE}/committees/${id}/join`, {}, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

// ─── Events ───────────────────────────────────────────────────────────────────

const toEventSummary = (e: Event): EventSummary => {
  const { id, title, startsAt, location, state, paid, feeKobo, registered, rsvp, coverUrl } = e;
  return { id, title, startsAt, location, state, paid, feeKobo, registered, rsvp, coverUrl };
};

export async function getEvents(): Promise<EventSummary[]> {
  if (USE_MOCK) { await delay(); return MOCK_EVENTS.map(toEventSummary); }
  const { data } = await api.get(`${BASE}/events`);
  return data;
}

/**
 * The Go event-detail DTO names the caller's own RSVP `myRsvp`; every screen in
 * this module reads `rsvp`. Normalising here keeps that seam in one place
 * instead of scattering `rsvp ?? myRsvp` through the UI. List DTOs already
 * carry `rsvp` and are left alone.
 */
function normaliseEvent(dto: (Event & { myRsvp?: EventRsvp }) | null | undefined): Event {
  const raw = (dto ?? {}) as Event & { myRsvp?: EventRsvp };
  const { myRsvp, ...rest } = raw;
  return { ...rest, rsvp: rest.rsvp ?? myRsvp ?? null } as Event;
}

export async function getEvent(id: string): Promise<Event> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_EVENTS.find((e) => e.id === id);
    if (!found) throw new Error('Event not found');
    return found;
  }
  const { data } = await api.get(`${BASE}/events/${id}`);
  return normaliseEvent(data);
}

export async function rsvpEvent(id: string, rsvp: EventRsvp): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  const { data } = await api.post(`${BASE}/events/${id}/rsvp`, { rsvp });
  return data;
}

/**
 * Register for an event.
 *
 * The response shape changed with the paid-event money path: a paid event no
 * longer issues a free ticket. It answers `registered: false`,
 * `paymentRequired: true` and an `invoiceId`, and the caller must send the
 * member to settle that invoice (`/association/pay/[invoiceId]`) — the ticket
 * is released once it is PAID, so `ticketCode` is null until then.
 *
 * Calling it twice does not raise a second invoice: the server hands back the
 * outstanding one for the same (event, membership).
 */
export async function registerEvent(id: string): Promise<EventRegistrationResult> {
  if (USE_MOCK) {
    await delay(400);
    const mock = MOCK_EVENTS.find((e) => e.id === id);
    if (mock?.paid && mock.feeKobo > 0) {
      return {
        ok: true, registered: false, paymentRequired: true,
        ticketCode: null, invoiceId: `mock_inv_${id}`, amountKobo: mock.feeKobo,
      };
    }
    return {
      ok: true, registered: true, paymentRequired: false,
      ticketCode: `SPOTLIGHT:EVT:${id}:ticket`, invoiceId: null, amountKobo: 0,
    };
  }
  const { data } = await api.post(`${BASE}/events/${id}/register`, {}, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

export async function submitEventFeedback(id: string, rating: number, comment: string): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  const { data } = await api.post(`${BASE}/events/${id}/feedback`, { rating, comment });
  return data;
}
