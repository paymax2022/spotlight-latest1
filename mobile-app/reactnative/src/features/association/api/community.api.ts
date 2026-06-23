// ── Association — Committees & Events API wrapper ─────────────────────────────

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK } from '../constants/association.constants';
import type {
  Committee, CommitteeSummary, Event, EventSummary, EventRsvp,
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
  const { data } = await api.get('/associations/committees');
  return data;
}

export async function getCommittee(id: string): Promise<Committee> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_COMMITTEES.find((c) => c.id === id);
    if (!found) throw new Error('Committee not found');
    return found;
  }
  const { data } = await api.get(`/associations/committees/${id}`);
  return data;
}

export async function requestJoinCommittee(id: string): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  const { data } = await api.post(`/associations/committees/${id}/join`, {}, {
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
  const { data } = await api.get('/associations/events');
  return data;
}

export async function getEvent(id: string): Promise<Event> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_EVENTS.find((e) => e.id === id);
    if (!found) throw new Error('Event not found');
    return found;
  }
  const { data } = await api.get(`/associations/events/${id}`);
  return data;
}

export async function rsvpEvent(id: string, rsvp: EventRsvp): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  const { data } = await api.post(`/associations/events/${id}/rsvp`, { rsvp });
  return data;
}

export async function registerEvent(id: string): Promise<{ ok: true; ticketCode: string }> {
  if (USE_MOCK) { await delay(400); return { ok: true, ticketCode: `SPOTLIGHT:EVT:${id}:ticket` }; }
  const { data } = await api.post(`/associations/events/${id}/register`, {}, {
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
  });
  return data;
}

export async function submitEventFeedback(id: string, rating: number, comment: string): Promise<{ ok: true }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  const { data } = await api.post(`/associations/events/${id}/feedback`, { rating, comment });
  return data;
}
