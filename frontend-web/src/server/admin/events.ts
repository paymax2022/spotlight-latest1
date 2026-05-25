import { randomUUID } from 'crypto';

export interface AdminEvent {
  id: string;
  title: string;
  program: string;
  contest?: string;
  venue: string;
  address?: string;
  city?: string;
  state?: string;
  startsAt: string;
  endsAt?: string;
  capacity?: number;
  status: 'draft' | 'scheduled' | 'live' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

interface EventStore {
  events: Map<string, AdminEvent>;
}

function now() {
  return new Date().toISOString();
}

function getStore(): EventStore {
  const key = '__spotlightAdminEventStore';
  const g = globalThis as unknown as Record<string, EventStore | undefined>;
  if (!g[key]) {
    const t = now();
    const seed: AdminEvent = {
      id: randomUUID(),
      title: 'Open Mic Grand Finale - June Edition',
      program: 'Open Mic',
      contest: 'spotlight-open-mic-june-edition',
      venue: 'The Spotlight Lounge',
      city: 'Lagos',
      state: 'Lagos',
      startsAt: t,
      status: 'scheduled',
      createdAt: t,
      updatedAt: t,
    };
    g[key] = { events: new Map([[seed.id, seed]]) };
  }
  return g[key] as EventStore;
}

export function listEvents() {
  return Array.from(getStore().events.values());
}

export function createEvent(input: Partial<AdminEvent>, actorId?: string) {
  const t = now();
  const event: AdminEvent = {
    id: randomUUID(),
    title: String(input.title || 'Untitled Event'),
    program: String(input.program || 'General'),
    contest: input.contest,
    venue: String(input.venue || 'TBD Venue'),
    address: input.address,
    city: input.city,
    state: input.state,
    startsAt: String(input.startsAt || t),
    endsAt: input.endsAt,
    capacity: Number(input.capacity || 0) || undefined,
    status: input.status || 'draft',
    createdAt: t,
    updatedAt: t,
    createdBy: actorId,
    updatedBy: actorId,
  };
  getStore().events.set(event.id, event);
  return event;
}

export function updateEvent(id: string, patch: Partial<AdminEvent>, actorId?: string) {
  const current = getStore().events.get(id);
  if (!current) return null;
  const updated: AdminEvent = {
    ...current,
    ...patch,
    updatedAt: now(),
    updatedBy: actorId || current.updatedBy,
  };
  getStore().events.set(id, updated);
  return updated;
}

