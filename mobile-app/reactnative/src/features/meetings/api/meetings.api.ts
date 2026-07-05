// ── Estate Meetings API surface (Block 30) ───────────────────────────────────
// Dual path: USE_MOCK in-memory store, else live HTTP to the resident-scoped
// /api/v1/estate/meetings handlers (estate resolved server-side; see constants).
// Signatures/types/hooks are identical for both.

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { MEETINGS_API_BASE as B, USE_MOCK } from '../constants/meetings.constants';
import type {
  CreateMeetingInput,
  Meeting,
  MeetingMinutes,
  RsvpInput,
} from '../types/meetings.types';
import { seedMeetings, seedMinutes } from './meetings.mock';

let meetings: Meeting[] = JSON.parse(JSON.stringify(seedMeetings));
const minutes: Record<string, MeetingMinutes> = JSON.parse(JSON.stringify(seedMinutes));
const latency = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const idem = (key?: string) => ({ headers: { 'Idempotency-Key': key ?? generateIdempotencyKey() } });

export class MeetingApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'MeetingApiError';
  }
}

export async function listMeetings(): Promise<Meeting[]> {
  if (USE_MOCK) {
    await latency();
    return meetings.slice().sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  }
  const { data } = await api.get<Meeting[]>(B);
  return data;
}

export async function getMeeting(id: string): Promise<Meeting> {
  if (USE_MOCK) {
    await latency(250);
    const m = meetings.find((x) => x.id === id);
    if (!m) throw new MeetingApiError('NOT_FOUND', 'Meeting not found.');
    return { ...m };
  }
  const { data } = await api.get<Meeting>(`${B}/${id}`);
  return data;
}

export async function createMeeting(input: CreateMeetingInput): Promise<Meeting> {
  if (USE_MOCK) {
    await latency(500);
    if (!input.title.trim()) throw new MeetingApiError('VALIDATION', 'Meeting title is required.');
    const m: Meeting = {
      id: `mtg_${Date.now()}`,
      estateId: 'est_amber_court',
      title: input.title.trim(),
      agenda: input.agenda?.trim() || undefined,
      mode: input.mode,
      location: input.location?.trim() || undefined,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: 'scheduled',
      createdBy: 'res_demo',
      createdByName: 'You',
      createdAt: new Date().toISOString(),
      myRsvp: 'yes',
      rsvpCounts: { yes: 1, no: 0, maybe: 0 },
    };
    meetings = [m, ...meetings];
    return { ...m };
  }
  const { data } = await api.post<Meeting>(B, input, idem(input.idempotencyKey));
  return data;
}

export async function rsvpMeeting(input: RsvpInput): Promise<Meeting> {
  if (USE_MOCK) {
    await latency(300);
    const m = meetings.find((x) => x.id === input.meetingId);
    if (!m) throw new MeetingApiError('NOT_FOUND', 'Meeting not found.');
    // Adjust counts: remove previous response, add the new one.
    if (m.myRsvp) m.rsvpCounts[m.myRsvp] = Math.max(0, m.rsvpCounts[m.myRsvp] - 1);
    m.myRsvp = input.response;
    m.rsvpCounts[input.response] += 1;
    return { ...m };
  }
  const { data } = await api.post<Meeting>(`${B}/${input.meetingId}/rsvp`, { response: input.response }, idem(input.idempotencyKey));
  return data;
}

export async function getMeetingMinutes(meetingId: string): Promise<MeetingMinutes | null> {
  if (USE_MOCK) {
    await latency(250);
    return minutes[meetingId] ?? null;
  }
  const { data } = await api.get<MeetingMinutes | null>(`${B}/${meetingId}/minutes`);
  return data ?? null;
}

export function __resetMeetingsStore(): void {
  meetings = JSON.parse(JSON.stringify(seedMeetings));
}
