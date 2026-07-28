// ── Admin — Paymax Mobility service ──────────────────────────────────────────
// Mock-backed (Go backend admin endpoints not live yet). Mirrors fxAdminService /
// crowdfundingAdminService shape: flip USE_MOCK to false and the fetch branches
// hit /api/finance/admin/transport/... per the Mobility BUILD-CONTRACT.
// All money is integer minor units (kobo). Every mutation is server-audited.

import { env } from '@/config/env';
import type {
  MobilityDashboard,
  DriverSummary, DriverDetail, DriverVerificationDecision, DriverVerificationStatus,
  VehicleComplianceRow, VehicleStatusPatch, VehicleStatus,
  TripRow, DispatchLive, TripPhase,
  PricingConfig, CommissionConfig,
  SafetyIncidentRow, SafetyIncidentPatch, IncidentStatus,
  ReportSummary, MobilityAuditEntry,
} from '@/types/mobility';

// Mock by default; flip with NEXT_PUBLIC_MOBILITY_ADMIN_USE_MOCK=false once the
// admin control-plane endpoints are live on the Go backend.
const USE_MOCK = (process.env.NEXT_PUBLIC_MOBILITY_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  // env.apiBaseUrl defaults to .../api/v1 ; admin transport lives under /api/finance/admin/transport
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance/admin/transport');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// ─── Mock datasets ────────────────────────────────────────────────────────────

const DASHBOARD: MobilityDashboard = {
  totalTrips: 18_420,
  completedTrips: 16_932,
  cancelledTrips: 1_488,
  gbvKobo: 92_410_500_00,
  platformRevenueKobo: 18_482_100_00,
  driverEarningsKobo: 73_928_400_00,
  completionRate: 91.9,
  cancellationRate: 8.1,
  openSafetyIncidents: 3,
  activeDrivers: 642,
  onlineDrivers: 184,
  pendingVerifications: 11,
  liveTrips: 47,
  topZones: [
    { zone: 'Lagos Island', trips: 6_210, gbvKobo: 31_200_000_00 },
    { zone: 'Lekki', trips: 4_980, gbvKobo: 27_400_000_00 },
    { zone: 'Ikeja', trips: 3_840, gbvKobo: 18_900_000_00 },
    { zone: 'Yaba', trips: 2_140, gbvKobo: 9_100_000_00 },
    { zone: 'Surulere', trips: 1_250, gbvKobo: 5_810_500_00 },
  ],
};

let DRIVERS: DriverDetail[] = [
  {
    id: 'drv_1001', name: 'Emeka Obi', phone: '+2348012345678', email: 'emeka@example.com',
    verificationStatus: 'submitted', online: false, zone: 'Lekki',
    serviceCategories: ['ride_hailing', 'parcel'], completedTrips: 0, rating: 0, cancelRate: 0,
    commissionTier: 'standard', createdAt: '2026-06-18T09:00:00Z', photoUrl: null,
    documents: [
      { id: 'd1', type: 'drivers_license', label: "Driver's License", fileUrl: '#', status: 'pending', expiryDate: '2028-03-01' },
      { id: 'd2', type: 'nin', label: 'NIN Slip', fileUrl: '#', status: 'pending', expiryDate: null },
      { id: 'd3', type: 'proof_of_address', label: 'Proof of Address', fileUrl: '#', status: 'pending', expiryDate: null },
    ],
    vehicle: {
      id: 'veh_1', plateNumber: 'LND-221-KJA', make: 'Toyota', model: 'Corolla', year: 2019, color: 'Silver',
      category: 'standard', capacity: 4, status: 'inactive', inspectionStatus: 'pending', insuranceStatus: 'pending',
    },
    grossEarningsKobo: 0, platformFeeKobo: 0, netEarningsKobo: 0, notes: null,
  },
  {
    id: 'drv_1002', name: 'Aisha Bello', phone: '+2348023456789', email: 'aisha@example.com',
    verificationStatus: 'under_review', online: false, zone: 'Ikeja',
    serviceCategories: ['ride_hailing'], completedTrips: 0, rating: 0, cancelRate: 0,
    commissionTier: 'standard', createdAt: '2026-06-17T11:00:00Z', photoUrl: null,
    documents: [
      { id: 'd4', type: 'drivers_license', label: "Driver's License", fileUrl: '#', status: 'valid', expiryDate: '2027-09-01' },
      { id: 'd5', type: 'nin', label: 'NIN Slip', fileUrl: '#', status: 'valid', expiryDate: null },
      { id: 'd6', type: 'proof_of_address', label: 'Proof of Address', fileUrl: '#', status: 'failed', expiryDate: null },
    ],
    vehicle: {
      id: 'veh_2', plateNumber: 'IKJ-883-LAG', make: 'Honda', model: 'Accord', year: 2020, color: 'Black',
      category: 'comfort', capacity: 4, status: 'inactive', inspectionStatus: 'valid', insuranceStatus: 'pending',
    },
    grossEarningsKobo: 0, platformFeeKobo: 0, netEarningsKobo: 0, notes: 'Address document blurred — needs re-upload.',
  },
  {
    id: 'drv_1003', name: 'Tunde Adeyemi', phone: '+2348034567890', email: 'tunde@example.com',
    verificationStatus: 'approved', online: true, zone: 'Lagos Island',
    serviceCategories: ['ride_hailing', 'parcel'], completedTrips: 1_284, rating: 4.8, cancelRate: 3.2,
    commissionTier: 'gold', createdAt: '2026-01-10T08:00:00Z', photoUrl: null,
    documents: [
      { id: 'd7', type: 'drivers_license', label: "Driver's License", fileUrl: '#', status: 'valid', expiryDate: '2029-01-01' },
      { id: 'd8', type: 'nin', label: 'NIN Slip', fileUrl: '#', status: 'valid', expiryDate: null },
    ],
    vehicle: {
      id: 'veh_3', plateNumber: 'LSI-445-VIC', make: 'Lexus', model: 'ES 350', year: 2021, color: 'Grey',
      category: 'premium', capacity: 4, status: 'active', inspectionStatus: 'valid', insuranceStatus: 'valid',
    },
    grossEarningsKobo: 5_420_000_00, platformFeeKobo: 1_084_000_00, netEarningsKobo: 4_336_000_00, notes: null,
  },
  {
    id: 'drv_1004', name: 'Chidi Nwosu', phone: '+2348045678901', email: 'chidi@example.com',
    verificationStatus: 'suspended', online: false, zone: 'Yaba',
    serviceCategories: ['ride_hailing'], completedTrips: 410, rating: 3.9, cancelRate: 14.6,
    commissionTier: 'standard', createdAt: '2026-03-22T08:00:00Z', photoUrl: null,
    documents: [
      { id: 'd9', type: 'drivers_license', label: "Driver's License", fileUrl: '#', status: 'expired', expiryDate: '2026-05-01' },
    ],
    vehicle: {
      id: 'veh_4', plateNumber: 'YAB-110-MUS', make: 'Kia', model: 'Rio', year: 2017, color: 'Red',
      category: 'standard', capacity: 4, status: 'suspended', inspectionStatus: 'expired', insuranceStatus: 'valid',
    },
    grossEarningsKobo: 1_640_000_00, platformFeeKobo: 328_000_00, netEarningsKobo: 1_312_000_00,
    notes: 'Suspended pending safety review (high cancel rate + expired licence).',
  },
];

const TRIPS: TripRow[] = [
  { id: 'trp_5001', riderName: 'Ngozi A.', driverName: 'Tunde Adeyemi', driverId: 'drv_1003', phase: 'in_progress', fareKobo: 3_200_00, pickupAddress: 'Victoria Island', destAddress: 'Lekki Phase 1', zone: 'Lagos Island', serviceType: 'ride_hailing', sos: false, stuck: false, createdAt: '2026-06-20T10:05:00Z', updatedAt: '2026-06-20T10:18:00Z' },
  { id: 'trp_5002', riderName: 'Bola I.', driverName: 'Femi K.', driverId: 'drv_2010', phase: 'safety_hold', fareKobo: 1_800_00, pickupAddress: 'Yaba', destAddress: 'Surulere', zone: 'Yaba', serviceType: 'ride_hailing', sos: true, stuck: false, createdAt: '2026-06-20T10:02:00Z', updatedAt: '2026-06-20T10:14:00Z' },
  { id: 'trp_5003', riderName: 'Sola M.', driverName: null, driverId: null, phase: 'fare_negotiating', fareKobo: 2_400_00, pickupAddress: 'Ikeja GRA', destAddress: 'Maryland', zone: 'Ikeja', serviceType: 'ride_hailing', sos: false, stuck: true, createdAt: '2026-06-20T09:50:00Z', updatedAt: '2026-06-20T09:52:00Z' },
  { id: 'trp_5004', riderName: 'Uche O.', driverName: 'Aisha Bello', driverId: 'drv_1002', phase: 'driver_arriving', fareKobo: 1_500_00, pickupAddress: 'Ojota', destAddress: 'Ketu', zone: 'Ikeja', serviceType: 'ride_hailing', sos: false, stuck: false, createdAt: '2026-06-20T10:10:00Z', updatedAt: '2026-06-20T10:16:00Z' },
  { id: 'trp_4990', riderName: 'Kemi T.', driverName: 'Tunde Adeyemi', driverId: 'drv_1003', phase: 'completed', fareKobo: 4_100_00, pickupAddress: 'Lekki', destAddress: 'Ajah', zone: 'Lekki', serviceType: 'ride_hailing', sos: false, stuck: false, createdAt: '2026-06-20T08:30:00Z', updatedAt: '2026-06-20T09:05:00Z' },
  { id: 'trp_4985', riderName: 'David N.', driverName: null, driverId: null, phase: 'cancelled', fareKobo: 2_000_00, pickupAddress: 'Surulere', destAddress: 'Yaba', zone: 'Surulere', serviceType: 'ride_hailing', sos: false, stuck: false, createdAt: '2026-06-20T08:00:00Z', updatedAt: '2026-06-20T08:04:00Z' },
];

const ONLINE_DRIVERS = [
  { id: 'drv_1003', name: 'Tunde Adeyemi', zone: 'Lagos Island', rating: 4.8, serviceCategories: ['ride_hailing', 'parcel'], lat: 6.4281, lng: 3.4219, activeTripId: 'trp_5001' },
  { id: 'drv_2010', name: 'Femi K.', zone: 'Yaba', rating: 4.6, serviceCategories: ['ride_hailing'], lat: 6.5095, lng: 3.3711, activeTripId: 'trp_5002' },
  { id: 'drv_2011', name: 'Grace E.', zone: 'Ikeja', rating: 4.9, serviceCategories: ['ride_hailing'], lat: 6.6018, lng: 3.3515, activeTripId: null },
  { id: 'drv_2012', name: 'Ibrahim S.', zone: 'Lekki', rating: 4.7, serviceCategories: ['ride_hailing', 'parcel'], lat: 6.4474, lng: 3.4702, activeTripId: null },
];

const VEHICLES: VehicleComplianceRow[] = DRIVERS.filter((d) => d.vehicle).map((d) => ({
  id: d.vehicle!.id, driverId: d.id, driverName: d.name, plateNumber: d.vehicle!.plateNumber,
  make: d.vehicle!.make, model: d.vehicle!.model, year: d.vehicle!.year, category: d.vehicle!.category,
  status: d.vehicle!.status, inspectionStatus: d.vehicle!.inspectionStatus, insuranceStatus: d.vehicle!.insuranceStatus,
  inspectionExpiry: d.vehicle!.inspectionStatus === 'expired' ? '2026-05-01' : '2026-12-01',
  insuranceExpiry: d.vehicle!.insuranceStatus === 'expired' ? '2026-04-15' : '2027-01-10',
}));

let PRICING: PricingConfig[] = [
  { zone: 'Lagos Island', serviceType: 'ride_hailing', baseFareKobo: 500_00, perKmKobo: 120_00, perMinKobo: 25_00, minFareKobo: 800_00, fareFloorPct: 0.85, fareCeilingPct: 1.25, driverProfitFloorKobo: 400_00, surgeMultiplier: 1.0, version: 6, updatedAt: '2026-06-15T12:00:00Z' },
  { zone: 'Lekki', serviceType: 'ride_hailing', baseFareKobo: 600_00, perKmKobo: 140_00, perMinKobo: 28_00, minFareKobo: 1_000_00, fareFloorPct: 0.9, fareCeilingPct: 1.3, driverProfitFloorKobo: 500_00, surgeMultiplier: 1.2, version: 4, updatedAt: '2026-06-14T12:00:00Z' },
  { zone: 'Ikeja', serviceType: 'ride_hailing', baseFareKobo: 450_00, perKmKobo: 110_00, perMinKobo: 22_00, minFareKobo: 750_00, fareFloorPct: 0.85, fareCeilingPct: 1.2, driverProfitFloorKobo: 380_00, surgeMultiplier: 1.0, version: 3, updatedAt: '2026-06-12T12:00:00Z' },
];

let COMMISSION: CommissionConfig[] = [
  { tier: 'standard', driverPct: 80, platformPct: 20, updatedAt: '2026-06-01T12:00:00Z' },
  { tier: 'silver', driverPct: 83, platformPct: 17, updatedAt: '2026-06-01T12:00:00Z' },
  { tier: 'gold', driverPct: 86, platformPct: 14, updatedAt: '2026-06-01T12:00:00Z' },
  { tier: 'fleet', driverPct: 88, platformPct: 12, updatedAt: '2026-06-01T12:00:00Z' },
];

let INCIDENTS: SafetyIncidentRow[] = [
  { id: 'inc_9001', type: 'sos', status: 'open', severity: 'critical', tripId: 'trp_5002', riderName: 'Bola I.', driverName: 'Femi K.', zone: 'Yaba', description: 'Rider triggered SOS — vehicle stopped off-route for 6 minutes.', assignedAdmin: null, resolutionNote: null, lat: 6.5095, lng: 3.3711, createdAt: '2026-06-20T10:14:00Z' },
  { id: 'inc_9002', type: 'route_deviation', status: 'investigating', severity: 'high', tripId: 'trp_4990', riderName: 'Kemi T.', driverName: 'Tunde Adeyemi', zone: 'Lekki', description: 'Route deviated 1.8km from optimal path.', assignedAdmin: 'Safety Admin A', resolutionNote: null, lat: 6.4474, lng: 3.4702, createdAt: '2026-06-20T08:50:00Z' },
  { id: 'inc_9003', type: 'unsafe_behavior', status: 'open', severity: 'medium', tripId: null, riderName: 'Uche O.', driverName: 'Chidi Nwosu', zone: 'Yaba', description: 'Rider reported reckless driving and verbal abuse.', assignedAdmin: null, resolutionNote: null, lat: null, lng: null, createdAt: '2026-06-19T22:10:00Z' },
  { id: 'inc_9004', type: 'lost_item', status: 'resolved', severity: 'low', tripId: 'trp_4985', riderName: 'David N.', driverName: 'Grace E.', zone: 'Surulere', description: 'Rider left phone in vehicle. Returned via driver.', assignedAdmin: 'Support Admin B', resolutionNote: 'Item returned, confirmed by rider.', lat: null, lng: null, createdAt: '2026-06-19T18:40:00Z' },
];

const REPORTS: ReportSummary = {
  revenueByZone: [
    { zone: 'Lagos Island', gbvKobo: 31_200_000_00, revenueKobo: 6_240_000_00, trips: 6_210 },
    { zone: 'Lekki', gbvKobo: 27_400_000_00, revenueKobo: 5_480_000_00, trips: 4_980 },
    { zone: 'Ikeja', gbvKobo: 18_900_000_00, revenueKobo: 3_780_000_00, trips: 3_840 },
    { zone: 'Yaba', gbvKobo: 9_100_000_00, revenueKobo: 1_820_000_00, trips: 2_140 },
    { zone: 'Surulere', gbvKobo: 5_810_500_00, revenueKobo: 1_162_100_00, trips: 1_250 },
  ],
  commissionByTier: [
    { tier: 'standard', driverPayoutKobo: 28_400_000_00, platformKobo: 7_100_000_00, trips: 9_200 },
    { tier: 'silver', driverPayoutKobo: 18_200_000_00, platformKobo: 3_727_000_00, trips: 4_100 },
    { tier: 'gold', driverPayoutKobo: 21_800_000_00, platformKobo: 3_549_000_00, trips: 3_900 },
    { tier: 'fleet', driverPayoutKobo: 5_528_400_00, platformKobo: 753_900_00, trips: 1_220 },
  ],
  tripsByDay: [
    { date: '2026-06-14', completed: 2_310, cancelled: 198, gbvKobo: 12_400_000_00 },
    { date: '2026-06-15', completed: 2_480, cancelled: 210, gbvKobo: 13_100_000_00 },
    { date: '2026-06-16', completed: 2_390, cancelled: 224, gbvKobo: 12_700_000_00 },
    { date: '2026-06-17', completed: 2_520, cancelled: 205, gbvKobo: 13_500_000_00 },
    { date: '2026-06-18', completed: 2_610, cancelled: 231, gbvKobo: 13_900_000_00 },
    { date: '2026-06-19', completed: 2_122, cancelled: 220, gbvKobo: 11_800_000_00 },
  ],
  cancellation: { byRider: 712, byDriver: 498, bySystem: 278, total: 1_488 },
};

let AUDIT: MobilityAuditEntry[] = [
  { id: 'aud_1', action: 'driver.verification.approved', target: 'drv_1003 (Tunde Adeyemi)', actor: 'Driver Onboarding Admin', reason: 'All documents valid; inspection passed.', createdAt: '2026-06-15T10:00:00Z' },
  { id: 'aud_2', action: 'driver.verification.suspended', target: 'drv_1004 (Chidi Nwosu)', actor: 'Safety Admin', reason: 'High cancel rate + expired licence.', createdAt: '2026-06-18T14:30:00Z' },
  { id: 'aud_3', action: 'pricing.updated', target: 'Lekki / ride_hailing', actor: 'Pricing Admin', reason: 'Surge raised to 1.2 for peak demand.', createdAt: '2026-06-14T12:00:00Z' },
  { id: 'aud_4', action: 'safety.incident.resolved', target: 'inc_9004 (lost_item)', actor: 'Support Admin B', reason: 'Item returned to rider.', createdAt: '2026-06-19T19:00:00Z' },
];

function pushAudit(action: string, target: string, reason: string | null) {
  AUDIT = [
    { id: `aud_${Date.now()}`, action, target, actor: 'You (current admin)', reason, createdAt: new Date().toISOString() },
    ...AUDIT,
  ];
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export async function getDashboard(): Promise<MobilityDashboard> {
  if (USE_MOCK) { await delay(); return DASHBOARD; }
  const res = await fetch(`${adminBase()}/dashboard`, { headers: authHeaders() });
  return res.json();
}

// ─── Drivers ──────────────────────────────────────────────────────────────────
export async function getDrivers(status?: DriverVerificationStatus | ''): Promise<DriverSummary[]> {
  if (USE_MOCK) {
    await delay();
    let list = DRIVERS.map(({ photoUrl, documents, vehicle, grossEarningsKobo, platformFeeKobo, netEarningsKobo, notes, ...s }) => s);
    if (status) list = list.filter((d) => d.verificationStatus === status);
    return list;
  }
  const q = status ? `?status=${status}` : '';
  const res = await fetch(`${adminBase()}/drivers${q}`, { headers: authHeaders() });
  return res.json();
}

export async function getDriver(id: string): Promise<DriverDetail> {
  if (USE_MOCK) {
    await delay();
    const d = DRIVERS.find((x) => x.id === id);
    if (!d) throw new Error('Driver not found');
    return d;
  }
  const res = await fetch(`${adminBase()}/drivers/${id}`, { headers: authHeaders() });
  return res.json();
}

export async function setDriverVerification(id: string, decision: DriverVerificationDecision): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay(400);
    DRIVERS = DRIVERS.map((d) => (d.id === id ? { ...d, verificationStatus: decision.status, online: decision.status === 'approved' ? d.online : false } : d));
    pushAudit(`driver.verification.${decision.status}`, id, decision.reason);
    return { ok: true };
  }
  await fetch(`${adminBase()}/drivers/${id}/verification`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(decision) });
  return { ok: true };
}

// ─── Vehicles ─────────────────────────────────────────────────────────────────
export async function getVehicles(status?: VehicleStatus | ''): Promise<VehicleComplianceRow[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...VEHICLES];
    if (status) list = list.filter((v) => v.status === status);
    return list;
  }
  const q = status ? `?status=${status}` : '';
  const res = await fetch(`${adminBase()}/vehicles${q}`, { headers: authHeaders() });
  return res.json();
}

export async function setVehicleStatus(id: string, patch: VehicleStatusPatch): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay(400);
    const idx = VEHICLES.findIndex((v) => v.id === id);
    if (idx >= 0) {
      VEHICLES[idx] = {
        ...VEHICLES[idx],
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.inspectionStatus ? { inspectionStatus: patch.inspectionStatus } : {}),
        ...(patch.insuranceStatus ? { insuranceStatus: patch.insuranceStatus } : {}),
      };
    }
    pushAudit('vehicle.status.updated', id, patch.reason);
    return { ok: true };
  }
  await fetch(`${adminBase()}/vehicles/${id}/status`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) });
  return { ok: true };
}

// ─── Trips / Dispatch ─────────────────────────────────────────────────────────
export async function getTrips(phase?: TripPhase | ''): Promise<TripRow[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...TRIPS];
    if (phase) list = list.filter((t) => t.phase === phase);
    return list;
  }
  const q = phase ? `?phase=${phase}` : '';
  const res = await fetch(`${adminBase()}/trips${q}`, { headers: authHeaders() });
  return res.json();
}

export async function getDispatchLive(): Promise<DispatchLive> {
  if (USE_MOCK) {
    await delay();
    const activeTrips = TRIPS.filter((t) => !['completed', 'cancelled', 'no_show'].includes(t.phase));
    return { activeTrips, onlineDrivers: ONLINE_DRIVERS };
  }
  const res = await fetch(`${adminBase()}/dispatch/live`, { headers: authHeaders() });
  return res.json();
}

export async function assignDriver(tripId: string, driverId: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay(450);
    const od = ONLINE_DRIVERS.find((d) => d.id === driverId);
    const t = TRIPS.find((x) => x.id === tripId);
    if (t) { t.driverId = driverId; t.driverName = od?.name ?? driverId; t.phase = 'driver_assigned'; t.stuck = false; }
    pushAudit('dispatch.manual_assign', `${tripId} → ${driverId}`, 'Manual dispatch by operations.');
    return { ok: true };
  }
  await fetch(`${adminBase()}/dispatch/${tripId}/assign`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ driver_id: driverId }) });
  return { ok: true };
}

// ─── Pricing & Commission ─────────────────────────────────────────────────────
export async function getPricing(): Promise<PricingConfig[]> {
  if (USE_MOCK) { await delay(); return PRICING; }
  const res = await fetch(`${adminBase()}/pricing`, { headers: authHeaders() });
  return res.json();
}

export async function updatePricing(zone: string, serviceType: string, patch: Partial<PricingConfig>): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay(400);
    PRICING = PRICING.map((p) => (p.zone === zone && p.serviceType === serviceType ? { ...p, ...patch, version: p.version + 1, updatedAt: new Date().toISOString() } : p));
    pushAudit('pricing.updated', `${zone} / ${serviceType}`, 'Pricing config updated.');
    return { ok: true };
  }
  await fetch(`${adminBase()}/pricing?zone=${encodeURIComponent(zone)}&service_type=${encodeURIComponent(serviceType)}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) });
  return { ok: true };
}

export async function getCommission(): Promise<CommissionConfig[]> {
  if (USE_MOCK) { await delay(); return COMMISSION; }
  const res = await fetch(`${adminBase()}/commission`, { headers: authHeaders() });
  return res.json();
}

export async function updateCommission(tier: CommissionConfig['tier'], driverPct: number): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay(350);
    COMMISSION = COMMISSION.map((c) => (c.tier === tier ? { ...c, driverPct, platformPct: 100 - driverPct, updatedAt: new Date().toISOString() } : c));
    pushAudit('commission.updated', tier, `Driver split set to ${driverPct}%.`);
    return { ok: true };
  }
  await fetch(`${adminBase()}/commission/${tier}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ driverPct }) });
  return { ok: true };
}

// ─── Safety ───────────────────────────────────────────────────────────────────
export async function getIncidents(status?: IncidentStatus | ''): Promise<SafetyIncidentRow[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...INCIDENTS];
    if (status) list = list.filter((i) => i.status === status);
    return list;
  }
  const q = status ? `?status=${status}` : '';
  const res = await fetch(`${adminBase()}/safety/incidents${q}`, { headers: authHeaders() });
  return res.json();
}

export async function updateIncident(id: string, patch: SafetyIncidentPatch): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay(400);
    INCIDENTS = INCIDENTS.map((i) => (i.id === id ? { ...i, ...patch } : i));
    pushAudit('safety.incident.updated', id, patch.resolutionNote ?? patch.status ?? null);
    return { ok: true };
  }
  await fetch(`${adminBase()}/safety/incidents/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) });
  return { ok: true };
}

// ─── Reports & Audit ──────────────────────────────────────────────────────────
export async function getReports(): Promise<ReportSummary> {
  if (USE_MOCK) { await delay(); return REPORTS; }
  const res = await fetch(`${adminBase()}/reports/summary`, { headers: authHeaders() });
  return res.json();
}

export async function getAudit(): Promise<MobilityAuditEntry[]> {
  if (USE_MOCK) { await delay(); return AUDIT; }
  const res = await fetch(`${adminBase()}/audit`, { headers: authHeaders() });
  return res.json();
}
