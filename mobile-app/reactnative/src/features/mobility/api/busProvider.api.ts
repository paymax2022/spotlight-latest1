// ── Bus provider marketplace — provider-side API wrapper ─────────────────────
// The OPERATOR side of the interstate bus marketplace: register/upgrade, manage
// profile, create routes and departures, and pull per-departure manifests.
//
// IRON RULE: creating routes/schedules is FREE — no money moves here. Only the
// CUSTOMER booking (see bus.api.ts → bookBus) is a money mutation and carries an
// Idempotency-Key. Requests send snake_case bodies; responses are camelCase.

import { api } from '@/api/client';
import type {
  BusProviderMe,
  BusProviderProfile,
  BusProviderRoute,
  BusProviderSchedule,
  BusManifestEntry,
  BusProviderRegisterRequest,
  BusProviderUpdateRequest,
  BusRouteCreateRequest,
  BusRouteUpdateRequest,
  BusScheduleCreateRequest,
  BusDepartureTemplate,
  BusTemplateCreateRequest,
} from '../types/busProvider.types';
import { USE_MOCK } from './bus.api';
import {
  mockProviderMe,
  mockRegisterProvider,
  mockUpdateProvider,
  mockAddRoute,
  mockUpdateRoute,
  mockAddSchedule,
  mockManifest,
  mockListTemplates,
  mockCreateTemplate,
  mockSetTemplateActive,
  mockDeleteTemplate,
} from './busProvider.mock';

const BASE = '/api/v1/mobility';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

// GET /bus/provider/me → { provider|null, routes, upcomingSchedules }
export async function getProviderMe(): Promise<BusProviderMe> {
  if (USE_MOCK) {
    await delay(340);
    return mockProviderMe();
  }
  return unwrap<BusProviderMe>(await api.get(`${BASE}/bus/provider/me`));
}

// POST /bus/provider/register {business_name,contact_phone,contact_email?,base_state,description?}
export async function registerProvider(req: BusProviderRegisterRequest): Promise<BusProviderProfile> {
  if (USE_MOCK) {
    await delay(600);
    return mockRegisterProvider(req);
  }
  return unwrap<BusProviderProfile>(
    await api.post(`${BASE}/bus/provider/register`, {
      business_name: req.businessName,
      contact_phone: req.contactPhone,
      ...(req.contactEmail ? { contact_email: req.contactEmail } : {}),
      base_state: req.baseState,
      ...(req.description ? { description: req.description } : {}),
    }),
  );
}

// PATCH /bus/provider/me
export async function updateProvider(req: BusProviderUpdateRequest): Promise<BusProviderProfile> {
  if (USE_MOCK) {
    await delay(420);
    return mockUpdateProvider(req);
  }
  return unwrap<BusProviderProfile>(
    await api.patch(`${BASE}/bus/provider/me`, {
      ...(req.businessName !== undefined && { business_name: req.businessName }),
      ...(req.contactPhone !== undefined && { contact_phone: req.contactPhone }),
      ...(req.contactEmail !== undefined && { contact_email: req.contactEmail }),
      ...(req.baseState !== undefined && { base_state: req.baseState }),
      ...(req.description !== undefined && { description: req.description }),
    }),
  );
}

// POST /bus/provider/routes {from_state,to_state,from_city,to_city,bus_type,base_fare_kobo,amenities?}
export async function createRoute(req: BusRouteCreateRequest): Promise<BusProviderRoute> {
  if (USE_MOCK) {
    await delay(500);
    return mockAddRoute(req);
  }
  return unwrap<BusProviderRoute>(
    await api.post(`${BASE}/bus/provider/routes`, {
      from_state: req.fromState,
      to_state: req.toState,
      from_city: req.fromCity,
      to_city: req.toCity,
      bus_type: req.busType,
      base_fare_kobo: req.baseFareKobo,
      ...(req.amenities ? { amenities: req.amenities } : {}),
    }),
  );
}

// PATCH /bus/provider/routes/:id
export async function updateRoute(id: string, req: BusRouteUpdateRequest): Promise<BusProviderRoute> {
  if (USE_MOCK) {
    await delay(420);
    return mockUpdateRoute(id, req);
  }
  return unwrap<BusProviderRoute>(
    await api.patch(`${BASE}/bus/provider/routes/${id}`, {
      ...(req.fromState !== undefined && { from_state: req.fromState }),
      ...(req.toState !== undefined && { to_state: req.toState }),
      ...(req.fromCity !== undefined && { from_city: req.fromCity }),
      ...(req.toCity !== undefined && { to_city: req.toCity }),
      ...(req.busType !== undefined && { bus_type: req.busType }),
      ...(req.baseFareKobo !== undefined && { base_fare_kobo: req.baseFareKobo }),
      ...(req.amenities !== undefined && { amenities: req.amenities }),
    }),
  );
}

// POST /bus/provider/routes/:id/schedules {departure_time,total_seats,fare_kobo}
export async function createSchedule(routeId: string, req: BusScheduleCreateRequest): Promise<BusProviderSchedule> {
  if (USE_MOCK) {
    await delay(500);
    return mockAddSchedule(routeId, req);
  }
  return unwrap<BusProviderSchedule>(
    await api.post(`${BASE}/bus/provider/routes/${routeId}/schedules`, {
      departure_time: req.departureTime,
      total_seats: req.totalSeats,
      fare_kobo: req.fareKobo,
    }),
  );
}

// ─── Recurring departure templates ─────────────────────────────────────────────

// GET /bus/provider/templates → { templates }
export async function listTemplates(): Promise<BusDepartureTemplate[]> {
  if (USE_MOCK) {
    await delay(320);
    return mockListTemplates();
  }
  const res = await api.get(`${BASE}/bus/provider/templates`);
  return (res.data?.templates ?? res.data?.data ?? []) as BusDepartureTemplate[];
}

// POST /bus/provider/templates {route_id,days_of_week,depart_time,total_seats,fare_kobo,horizon_days?}
export async function createTemplate(req: BusTemplateCreateRequest): Promise<BusDepartureTemplate> {
  if (USE_MOCK) {
    await delay(500);
    return mockCreateTemplate(req);
  }
  const res = await api.post(`${BASE}/bus/provider/templates`, {
    route_id: req.routeId,
    days_of_week: req.daysOfWeek,
    depart_time: req.departTime,
    total_seats: req.totalSeats,
    fare_kobo: req.fareKobo,
    ...(req.horizonDays !== undefined ? { horizon_days: req.horizonDays } : {}),
  });
  return (res.data?.template ?? res.data?.data ?? res.data) as BusDepartureTemplate;
}

// PATCH /bus/provider/templates/:id {active}
export async function setTemplateActive(id: string, active: boolean): Promise<BusDepartureTemplate> {
  if (USE_MOCK) {
    await delay(320);
    return mockSetTemplateActive(id, active);
  }
  const res = await api.patch(`${BASE}/bus/provider/templates/${id}`, { active });
  return (res.data?.template ?? res.data?.data ?? res.data) as BusDepartureTemplate;
}

// DELETE /bus/provider/templates/:id → { ok: true }
export async function deleteTemplate(id: string): Promise<void> {
  if (USE_MOCK) {
    await delay(320);
    mockDeleteTemplate(id);
    return;
  }
  await api.delete(`${BASE}/bus/provider/templates/${id}`);
}

// GET /bus/provider/bookings?scheduleId → manifest
export async function getManifest(scheduleId: string): Promise<BusManifestEntry[]> {
  if (USE_MOCK) {
    await delay(320);
    return mockManifest(scheduleId);
  }
  const res = await api.get(`${BASE}/bus/provider/bookings`, { params: { scheduleId } });
  return (res.data?.bookings ?? res.data?.data ?? res.data ?? []) as BusManifestEntry[];
}
