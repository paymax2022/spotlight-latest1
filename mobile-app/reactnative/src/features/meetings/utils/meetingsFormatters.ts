import type { Meeting, MeetingStatus } from '../types/meetings.types';

export function formatMeetingWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function timeRange(startsAt: string, endsAt?: string): string {
  const start = new Date(startsAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
  if (!endsAt) return start;
  const end = new Date(endsAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
  return `${start} – ${end}`;
}

// Derive display status from the window (a "scheduled" meeting may be live/ended now).
export function derivedStatus(m: Meeting): MeetingStatus {
  if (m.status === 'cancelled') return 'cancelled';
  const now = Date.now();
  if (now >= +new Date(m.startsAt) && (!m.endsAt || now < +new Date(m.endsAt))) return 'live';
  if (m.endsAt && now >= +new Date(m.endsAt)) return 'ended';
  if (now >= +new Date(m.startsAt)) return m.status === 'ended' ? 'ended' : 'live';
  return 'scheduled';
}

export function isUpcoming(m: Meeting): boolean {
  const s = derivedStatus(m);
  return s === 'scheduled' || s === 'live';
}

export function totalRsvp(m: Meeting): number {
  return m.rsvpCounts.yes + m.rsvpCounts.no + m.rsvpCounts.maybe;
}
