// ── Towing — mock seed data + deterministic engine ───────────────────────────
// All money is integer kobo. Callout + distance pricing mimics the SERVER.

import type {
  TowingJob,
  TowingEstimate,
  TowingEstimateRequest,
  TowingServiceType,
  TowingOperator,
  Place,
} from '../types/modes.types';
import { haversineMeters } from '../utils/mobilityFormatters';

const now = () => Date.now();
const iso = (msAgo = 0) => new Date(now() - msAgo).toISOString();
const pin = () => String(1000 + Math.floor(Math.random() * 9000));

const CALLOUT: Record<TowingServiceType, number> = {
  flatbed: 12_000_00,
  wheel_lift: 9_000_00,
  heavy_duty: 25_000_00,
  roadside: 6_000_00,
};

const DEFAULT_PICKUP: Place = { address: '3rd Mainland Bridge (Lagos-bound)', lat: 6.5, lng: 3.4 };
const DEFAULT_DEST: Place = { address: 'AutoWorks Garage, Ikeja', lat: 6.6018, lng: 3.3515 };

export const MOCK_OPERATOR: TowingOperator = {
  id: 'two_1',
  name: 'Ifeanyi Okeke',
  photoUrl: null,
  rating: 4.81,
  truck: 'Flatbed • LSD-417-XA',
  phoneMasked: '+234 ••• ••• 3390',
};

export function mockTowingEstimate(req: TowingEstimateRequest): TowingEstimate {
  const callout = CALLOUT[req.serviceType];
  const distanceM = req.dest ? Math.max(1000, Math.round(haversineMeters(req.pickup, req.dest) * 1.3)) : 0;
  const distanceKobo = Math.round((distanceM / 1000) * 350_00);
  return {
    calloutKobo: callout,
    distanceKobo,
    totalKobo: callout + distanceKobo,
    distanceM,
    etaS: 900 + Math.floor(Math.random() * 600),
    currency: 'NGN',
  };
}

export function makeTowingJob(overrides: Partial<TowingJob> = {}): TowingJob {
  const est = mockTowingEstimate({ serviceType: 'flatbed', issue: 'breakdown', pickup: DEFAULT_PICKUP, dest: DEFAULT_DEST, vehicleType: 'sedan' });
  return {
    id: `tow_${now()}`,
    phase: 'requested',
    serviceType: 'flatbed',
    issue: 'breakdown',
    vehicleType: 'sedan',
    pickup: DEFAULT_PICKUP,
    dest: DEFAULT_DEST,
    fareKobo: est.totalKobo,
    currency: 'NGN',
    photoUrl: null,
    towPin: pin(),
    operator: null,
    operatorEtaS: null,
    paymentStatus: 'escrowed',
    createdAt: iso(),
    completedAt: null,
    rated: false,
    ...overrides,
  };
}

export const towingStore: { active: TowingJob | null } = { active: null };

export const MOCK_TOWING_HISTORY: TowingJob[] = [
  makeTowingJob({
    id: 'tow_h1', phase: 'completed', serviceType: 'wheel_lift', issue: 'flat_tyre',
    fareKobo: 11_400_00, paymentStatus: 'settled', operator: MOCK_OPERATOR, towPin: null,
    createdAt: iso(86_400_000 * 4), completedAt: iso(86_400_000 * 4 - 2_700_000), rated: true,
  }),
];

export function advanceMockTowing(j: TowingJob): TowingJob {
  if (['completed', 'cancelled'].includes(j.phase)) return j;
  const ageMs = now() - new Date(j.createdAt).getTime();
  if (j.phase === 'requested' && ageMs > 6_000) {
    j.phase = 'operator_accepted';
    j.operator = MOCK_OPERATOR;
    j.operatorEtaS = 1080;
  }
  if (j.phase === 'operator_accepted' && ageMs > 14_000) {
    j.phase = 'operator_en_route';
    j.operatorEtaS = 360;
  }
  if (j.phase === 'operator_en_route' && ageMs > 26_000) j.phase = 'pin_verified';
  if (j.phase === 'pin_verified' && ageMs > 32_000) j.phase = 'in_progress';
  if (j.phase === 'in_progress' && ageMs > 48_000) {
    j.phase = 'completed';
    j.paymentStatus = 'settled';
    j.completedAt = iso();
    j.towPin = null;
  }
  return j;
}
