// In-memory seed + store for the Visitor module.
// Stands in for the backend until live endpoints exist. Kept separate from the
// api surface so swapping to real HTTP later only touches visitor.api.ts.

import type {
  AccessCode,
  GateSession,
  RestrictionStatus,
  VisitEvent,
} from '../types/visitor.types';

const ESTATE_ID = 'est_amber_court';
const ESTATE_NAME = 'Amber Court Estate';
const RESIDENT_ID = 'res_demo';
const HOST_NAME = 'Tunde Bakare';
const UNIT = 'Block C, Flat 4';

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const H = 3_600_000;
const D = 24 * H;

function makeCode(p: Partial<AccessCode> & Pick<AccessCode, 'id' | 'codeValue' | 'codeType' | 'purposeLabel' | 'status' | 'visitor' | 'validityEnd'>): AccessCode {
  return {
    estateId: ESTATE_ID,
    estateName: ESTATE_NAME,
    hostResidentId: RESIDENT_ID,
    hostName: HOST_NAME,
    propertyId: 'prop_c4',
    unitLabel: UNIT,
    qrPayload: `PMX|${ESTATE_ID}|${p.codeValue}|${p.validityEnd}`,
    maxEntries: 1,
    entriesUsed: 0,
    usageMode: 'one_time',
    partySize: 1,
    recurrenceRule: null,
    validityStart: iso(-H),
    createdAt: iso(-2 * H),
    createdBy: RESIDENT_ID,
    ...p,
  } as AccessCode;
}

export const seedCodes: AccessCode[] = [
  makeCode({
    id: 'code_1', codeValue: '482913', codeType: 'one_time', purposeLabel: 'Guest',
    status: 'active', validityEnd: iso(5 * H), usageMode: 'entry_exit', partySize: 3, maxEntries: 20,
    visitor: { name: 'Amaka Obi', phone: '+2348031234567', purpose: 'Family visit', expectedArrival: iso(2 * H) },
  }),
  makeCode({
    id: 'code_2', codeValue: '730184', codeType: 'delivery', purposeLabel: 'Delivery',
    status: 'active', validityEnd: iso(2 * H), maxEntries: 1,
    visitor: { name: 'Jumia Rider', phone: '+2349090001122', purpose: 'Package delivery', vehiclePlate: 'LND-455-KJA', vehicleDesc: 'Red motorcycle' },
  }),
  makeCode({
    id: 'code_3', codeValue: '11920734', codeType: 'domestic_staff', purposeLabel: 'Staff',
    status: 'active', validityEnd: iso(60 * D), maxEntries: 200, entriesUsed: 47,
    usageMode: 'entry_exit', partySize: 1,
    recurrenceRule: 'MON-SAT 07:00-18:00',
    visitor: { name: 'Grace Eze', phone: '+2348127654321', purpose: 'Domestic help' },
  }),
  makeCode({
    id: 'code_4', codeValue: '556210', codeType: 'ride_hailing', purposeLabel: 'Ride',
    status: 'used', validityEnd: iso(-3 * H), maxEntries: 1, entriesUsed: 1,
    visitor: { name: 'Bolt Driver', phone: '+2348009998877', vehiclePlate: 'AKD-901-LA', vehicleDesc: 'Silver Corolla' },
  }),
  makeCode({
    id: 'code_5', codeValue: '204859', codeType: 'time_limited', purposeLabel: 'Guest',
    status: 'expired', validityEnd: iso(-D), maxEntries: 1,
    visitor: { name: 'Chidi Nwosu', phone: '+2348061112233', purpose: 'Business meeting' },
  }),
  makeCode({
    id: 'code_6', codeValue: '889001', codeType: 'contractor', purposeLabel: 'Contractor',
    status: 'revoked', validityEnd: iso(3 * D), maxEntries: 20, entriesUsed: 2,
    visitor: { name: 'CoolBreeze AC', phone: '+2348044556677', purpose: 'AC servicing', vehiclePlate: 'KJA-220-XA' },
  }),
  makeCode({
    id: 'code_7', codeValue: '660247', codeType: 'one_time', purposeLabel: 'Guest',
    status: 'active', validityEnd: iso(4 * H), maxEntries: 1,
    visitor: {
      name: 'Flagged Individual', phone: '+2348070000000',
      isBlacklisted: true, blacklistReason: 'Previously escorted off the premises. Do not admit — escalate to security.',
    },
  }),
];

export const seedEvents: VisitEvent[] = [
  { id: 'ev_1', accessCodeId: 'code_4', visitorName: 'Bolt Driver', unitLabel: UNIT, gateId: 'gate_main', guardId: 'guard_1', action: 'check_out', timestamp: iso(-2.5 * H), syncStatus: 'synced', capturedPlate: 'AKD-901-LA', codeType: 'ride_hailing' },
  { id: 'ev_2', accessCodeId: 'code_4', visitorName: 'Bolt Driver', unitLabel: UNIT, gateId: 'gate_main', guardId: 'guard_1', action: 'check_in', timestamp: iso(-3 * H), syncStatus: 'synced', capturedPlate: 'AKD-901-LA', codeType: 'ride_hailing' },
  { id: 'ev_3', visitorName: 'Unknown caller', unitLabel: 'Block A, Flat 1', gateId: 'gate_main', guardId: 'guard_1', action: 'deny', reason: 'Resident not reachable', timestamp: iso(-5 * H), syncStatus: 'synced' },
  { id: 'ev_4', accessCodeId: 'code_3', visitorName: 'Grace Eze', unitLabel: UNIT, gateId: 'gate_main', guardId: 'guard_1', action: 'check_in', timestamp: iso(-6 * H), syncStatus: 'pending', codeType: 'domestic_staff' },
  // Overstay demo: a walk-in admitted ~11h ago (past the 8h walk-in window), still inside.
  { id: 'ev_5', visitorName: 'Dele Coker', unitLabel: 'Block B, Flat 7', gateId: 'gate_main', guardId: 'guard_1', action: 'walk_in', reason: 'Contractor — resident approval', timestamp: iso(-11 * H), syncStatus: 'synced' },
];

export const seedRestriction: RestrictionStatus = {
  residentId: RESIDENT_ID,
  estateId: ESTATE_ID,
  state: 'good_standing',
  outstandingBalanceKobo: 0,
  effectiveFrom: iso(-30 * D),
  source: 'payments',
};

export const seedGateSession: GateSession = {
  id: 'gs_1',
  gateId: 'gate_main',
  gateLabel: 'Main Gate',
  guardId: 'guard_1',
  guardName: 'Musa Ibrahim',
  shiftStart: iso(-4 * H),
  shiftEnd: null,
};

export const DEMO_IDS = { ESTATE_ID, ESTATE_NAME, RESIDENT_ID, HOST_NAME, UNIT };
