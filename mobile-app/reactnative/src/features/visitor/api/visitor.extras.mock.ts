// Seed data for the secondary visitor domains: notifications, blacklist,
// incidents, residents directory, analytics.

import type {
  BlacklistEntry,
  IncidentReport,
  PhonebookContact,
  ResidentDirectoryEntry,
  VisitorAnalytics,
  VisitorNotification,
} from '../types/visitor.types';
import { DEMO_IDS } from './visitor.mock';

// Simulated device phonebook. A production build reads this from `expo-contacts`
// after a permission prompt; the picker UI and fill behaviour stay identical.
export const seedContacts: PhonebookContact[] = [
  { id: 'c1', name: 'Amaka Obi', phone: '+2348031234567' },
  { id: 'c2', name: 'Chidi Nwosu', phone: '+2348061112233' },
  { id: 'c3', name: 'Ngozi Okeke', phone: '+2348030000002' },
  { id: 'c4', name: 'Emeka Eze', phone: '+2348030000003' },
  { id: 'c5', name: 'Fatima Sani', phone: '+2348030000004' },
  { id: 'c6', name: 'Bola Adeyemi', phone: '+2348051234567' },
  { id: 'c7', name: 'Ifeoma Okafor', phone: '+2348091234567' },
  { id: 'c8', name: 'Yusuf Bello', phone: '+2348071234567' },
];

const H = 3_600_000;
const D = 24 * H;
const iso = (off: number) => new Date(Date.now() + off).toISOString();

export const seedNotifications: VisitorNotification[] = [
  { id: 'n1', type: 'arrival',         title: 'Visitor at the gate',  body: 'Amaka Obi is being verified at Main Gate.',           timestamp: iso(-5 * 60_000), read: false, accessCodeId: 'code_1' },
  { id: 'n2', type: 'checked_in',      title: 'Visitor checked in',   body: 'Grace Eze entered the estate.',                       timestamp: iso(-6 * H),      read: false, accessCodeId: 'code_3' },
  { id: 'n3', type: 'denied',          title: 'Entry denied',         body: 'A visitor for your unit was denied: resident not reachable.', timestamp: iso(-5 * H), read: true },
  { id: 'n4', type: 'checked_out',     title: 'Visitor checked out',  body: 'Bolt Driver has left the estate.',                    timestamp: iso(-2.5 * H),    read: true,  accessCodeId: 'code_4' },
  { id: 'n5', type: 'overstayed',      title: 'Visitor overstayed',   body: 'Your contractor has exceeded the expected duration.',  timestamp: iso(-1 * H),      read: false },
];

export const seedBlacklist: BlacklistEntry[] = [
  { id: 'bl1', estateId: DEMO_IDS.ESTATE_ID, matchKind: 'phone', matchValue: '+2348070000000', name: 'Flagged Individual', reason: 'Previously escorted off the premises.', createdBy: 'guard_1', createdAt: iso(-10 * D) },
  { id: 'bl2', estateId: DEMO_IDS.ESTATE_ID, matchKind: 'plate', matchValue: 'XYZ-777-AB', name: 'Unknown', reason: 'Attempted unauthorised entry twice.', createdBy: 'admin_1', createdAt: iso(-4 * D) },
];

export const seedIncidents: IncidentReport[] = [
  { id: 'inc1', kind: 'suspicious', severity: 'medium', title: 'Loitering near Gate B', description: 'Two individuals observed for 20+ minutes.', gateId: 'gate_main', escalate: true, status: 'escalated', createdAt: iso(-3 * H) },
];

export const seedResidents: ResidentDirectoryEntry[] = [
  { id: 'res_demo', name: 'Tunde Bakare',  unitLabel: 'Block C, Flat 4', phone: '+2348030000001' },
  { id: 'res_2',    name: 'Ngozi Okeke',   unitLabel: 'Block A, Flat 1', phone: '+2348030000002' },
  { id: 'res_3',    name: 'Emeka Eze',     unitLabel: 'Block B, Flat 7', phone: '+2348030000003' },
  { id: 'res_4',    name: 'Fatima Sani',   unitLabel: 'Block D, Flat 2', phone: '+2348030000004' },
];

export const seedAnalytics: VisitorAnalytics = {
  rangeLabel: 'Last 7 days',
  totalEntries: 318,
  totalDenials: 14,
  overstays: 9,
  avgVerificationSeconds: 11,
  offlineSyncedPct: 99.4,
  byType: [
    { label: 'Guests', value: 132 },
    { label: 'Delivery', value: 88 },
    { label: 'Staff', value: 61 },
    { label: 'Ride', value: 24 },
    { label: 'Contractor', value: 13 },
  ],
  byHour: [
    { hour: '6a', value: 8 },
    { hour: '9a', value: 41 },
    { hour: '12p', value: 33 },
    { hour: '3p', value: 28 },
    { hour: '6p', value: 52 },
    { hour: '9p', value: 19 },
  ],
  restrictionImpact: { restrictedResidents: 6, avgRestoreMinutes: 4 },
};
