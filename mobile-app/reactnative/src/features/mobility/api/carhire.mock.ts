// ── Car hire — mock seed data + deterministic engine ─────────────────────────
// All money is integer kobo. Fare + deposit pricing mimics the SERVER.

import type {
  CarHireBooking,
  CarHireQuote,
  CarHireQuoteRequest,
  CarHireBookRequest,
  VehicleClass,
} from '../types/modes.types';

const now = () => Date.now();
const iso = (msAgo = 0) => new Date(now() - msAgo).toISOString();
const isoAhead = (ms: number) => new Date(now() + ms).toISOString();

const CLASS_HOURLY: Record<VehicleClass, number> = {
  economy: 6_000_00,
  executive: 12_000_00,
  suv: 15_000_00,
  luxury: 35_000_00,
  van: 14_000_00,
};

const CLASS_LABEL: Record<VehicleClass, string> = {
  economy: 'Toyota Corolla 2021 • Silver',
  executive: 'Honda Accord 2022 • Black',
  suv: 'Toyota Prado 2022 • Black',
  luxury: 'Mercedes S-Class 2023 • Black',
  van: 'Toyota Sienna 2021 • Grey',
};

export function mockCarHireQuote(req: CarHireQuoteRequest): CarHireQuote {
  const hourly = CLASS_HOURLY[req.vehicleClass];
  const fareKobo = hourly * Math.max(1, req.durationHours);
  const chauffeurKobo = req.chauffeur ? 5_000_00 * Math.max(1, req.durationHours) : 0;
  const depositKobo = Math.round(fareKobo * 0.25);
  return {
    fareKobo,
    chauffeurKobo,
    depositKobo,
    totalKobo: fareKobo + chauffeurKobo + depositKobo,
    currency: 'NGN',
  };
}

export function makeCarHireBooking(req: CarHireBookRequest, overrides: Partial<CarHireBooking> = {}): CarHireBooking {
  const quote = mockCarHireQuote(req);
  return {
    id: `chr_${now()}`,
    phase: 'confirmed',
    hireType: req.hireType,
    vehicleClass: req.vehicleClass,
    startAt: req.startAt,
    durationHours: req.durationHours,
    chauffeur: req.chauffeur,
    fareKobo: quote.fareKobo,
    depositKobo: quote.depositKobo,
    chauffeurKobo: quote.chauffeurKobo,
    currency: 'NGN',
    vehicleLabel: CLASS_LABEL[req.vehicleClass],
    plateNumber: 'LSR-770-VI',
    driverName: req.chauffeur ? 'Samuel Adeyemi' : null,
    paymentStatus: 'escrowed',
    createdAt: iso(),
    completedAt: null,
    ...overrides,
  };
}

export const carHireStore: { active: CarHireBooking | null } = { active: null };

export const MOCK_CARHIRE_HISTORY: CarHireBooking[] = [
  {
    id: 'chr_h1', phase: 'completed', hireType: 'daily', vehicleClass: 'suv',
    startAt: iso(86_400_000 * 7), durationHours: 8, chauffeur: true,
    fareKobo: 120_000_00, depositKobo: 30_000_00, chauffeurKobo: 40_000_00, currency: 'NGN',
    vehicleLabel: 'Toyota Prado 2022 • Black', plateNumber: 'LSR-770-VI', driverName: 'Samuel Adeyemi',
    paymentStatus: 'settled', createdAt: iso(86_400_000 * 8), completedAt: iso(86_400_000 * 7 - 28_800_000),
  },
];
