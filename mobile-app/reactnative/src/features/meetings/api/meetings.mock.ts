import type { Meeting, MeetingMinutes } from '../types/meetings.types';

const H = 3_600_000;
const D = 24 * H;
const iso = (off: number) => new Date(Date.now() + off).toISOString();

export const seedMeetings: Meeting[] = [
  {
    id: 'mtg_agm',
    estateId: 'est_amber_court',
    title: 'Q3 General Meeting',
    agenda: 'Service charge review, new security vendor, gate automation budget, AOB.',
    mode: 'hybrid',
    location: 'Clubhouse + Zoom',
    startsAt: iso(2 * D + 6 * H),
    endsAt: iso(2 * D + 8 * H),
    status: 'scheduled',
    createdBy: 'res_2',
    createdByName: 'Ngozi Okeke',
    createdAt: iso(-3 * D),
    myRsvp: null,
    rsvpCounts: { yes: 28, no: 4, maybe: 9 },
  },
  {
    id: 'mtg_security',
    estateId: 'est_amber_court',
    title: 'Security Committee Sync',
    agenda: 'Night patrol roster and CCTV coverage gaps.',
    mode: 'physical',
    location: 'Gatehouse',
    startsAt: iso(5 * H),
    endsAt: iso(6 * H),
    status: 'scheduled',
    createdBy: 'res_3',
    createdByName: 'Emeka Eze',
    createdAt: iso(-1 * D),
    myRsvp: 'yes',
    rsvpCounts: { yes: 6, no: 1, maybe: 2 },
  },
  {
    id: 'mtg_budget',
    estateId: 'est_amber_court',
    title: '2026 Budget Review',
    agenda: 'Approved the 2026 estate budget.',
    mode: 'physical',
    location: 'Clubhouse',
    startsAt: iso(-10 * D),
    endsAt: iso(-10 * D + 2 * H),
    status: 'ended',
    createdBy: 'res_2',
    createdByName: 'Ngozi Okeke',
    createdAt: iso(-14 * D),
    myRsvp: 'yes',
    rsvpCounts: { yes: 41, no: 6, maybe: 3 },
  },
];

export const seedMinutes: Record<string, MeetingMinutes> = {
  mtg_budget: {
    meetingId: 'mtg_budget',
    content: 'The committee presented the 2026 budget. After discussion, residents approved it with a 7% service-charge increase to fund solar backup.',
    decisions: ['2026 budget approved', 'Service charge +7% from January', 'Solar backup project greenlit'],
    updatedAt: iso(-10 * D + 3 * H),
  },
};
