// ── Association — Committees & Events mock dataset ────────────────────────────

import type { Committee, Event } from '../types/community.types';

export const MOCK_COMMITTEES: Committee[] = [
  {
    id: 'cm1', name: 'Welfare Committee', purpose: 'Member welfare & support',
    memberCount: 12, joinStatus: 'MEMBER', myRole: 'Member',
    description: 'Coordinates welfare support, bereavement assistance, and member hardship cases across the chapter.',
    chair: 'Dr. Adebayo Williams', secretary: 'Mrs. Ngozi Eze',
    members: [
      { id: 'u9', name: 'Dr. Adebayo Williams', role: 'Chairperson', photoUrl: null },
      { id: 'u12', name: 'Mrs. Ngozi Eze', role: 'Secretary', photoUrl: null },
      { id: 'me', name: 'Dr. Chidinma Okeke', role: 'Member', photoUrl: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=200&q=80' },
    ],
    meetingsCount: 6, tasksCount: 3, docsCount: 4, chatThreadId: 'th3',
  },
  {
    id: 'cm2', name: 'Finance Committee', purpose: 'Budgets & oversight',
    memberCount: 8, joinStatus: 'NONE', myRole: null,
    description: 'Oversees the chapter budget, dues structure, and financial reporting.',
    chair: 'Dr. Tunde Bakare', secretary: 'Mr. Sola Adeniyi',
    members: [
      { id: 'u20', name: 'Dr. Tunde Bakare', role: 'Chairperson', photoUrl: null },
      { id: 'u21', name: 'Mr. Sola Adeniyi', role: 'Secretary', photoUrl: null },
    ],
    meetingsCount: 4, tasksCount: 2, docsCount: 7, chatThreadId: null,
  },
  {
    id: 'cm3', name: 'Events Committee', purpose: 'CPD & social events',
    memberCount: 10, joinStatus: 'PENDING', myRole: null,
    description: 'Plans CPD seminars, the AGM, and chapter social events.',
    chair: 'Dr. Fatima Bello', secretary: 'Dr. Emeka Nwosu',
    members: [
      { id: 'u2', name: 'Dr. Fatima Bello', role: 'Chairperson', photoUrl: null },
      { id: 'u3', name: 'Dr. Emeka Nwosu', role: 'Secretary', photoUrl: null },
    ],
    meetingsCount: 5, tasksCount: 4, docsCount: 2, chatThreadId: null,
  },
];

export const MOCK_EVENTS: Event[] = [
  {
    id: 'ev1', title: 'Quarterly CPD Seminar', startsAt: '2026-07-12T09:00:00Z', endsAt: '2026-07-12T15:00:00Z',
    location: 'NMA House, Ikeja', state: 'UPCOMING', paid: true, feeKobo: 500_000,
    registered: false, rsvp: null, coverUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&q=80',
    description: 'Earn 6 CPD points across emergency cardiology and ethics-in-practice sessions. Lunch included.',
    organiser: 'Events Committee', attendeeCount: 128, capacity: 200,
    documents: [{ id: 'ed1', name: 'Seminar programme.pdf' }],
    ticketCode: 'SPOTLIGHT:EVT:ev1:ticket', checkedIn: false, feedbackSubmitted: false,
  },
  {
    id: 'ev2', title: 'Annual General Meeting 2026', startsAt: '2026-08-30T10:00:00Z', endsAt: '2026-08-30T16:00:00Z',
    location: 'Eko Hotel, Victoria Island', state: 'UPCOMING', paid: false, feeKobo: 0,
    registered: true, rsvp: 'GOING', coverUrl: 'https://images.unsplash.com/photo-1511578314322-379afb476865?w=800&q=80',
    description: 'The chapter AGM: annual reports, elections, and the year-ahead plan. All members in good standing may attend.',
    organiser: 'National Secretariat', attendeeCount: 412, capacity: null,
    documents: [{ id: 'ed2', name: 'AGM agenda.pdf' }, { id: 'ed3', name: '2025 annual report.pdf' }],
    ticketCode: 'SPOTLIGHT:EVT:ev2:ticket', checkedIn: false, feedbackSubmitted: false,
  },
  {
    id: 'ev3', title: 'May Health Outreach', startsAt: '2026-05-18T08:00:00Z', endsAt: '2026-05-18T14:00:00Z',
    location: 'Mushin Community Centre', state: 'PAST', paid: false, feeKobo: 0,
    registered: true, rsvp: 'GOING', coverUrl: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&q=80',
    description: 'Free community health screening organised with volunteer members.',
    organiser: 'Welfare Committee', attendeeCount: 64, capacity: 80,
    documents: [], ticketCode: 'SPOTLIGHT:EVT:ev3:ticket', checkedIn: true, feedbackSubmitted: false,
  },
];
