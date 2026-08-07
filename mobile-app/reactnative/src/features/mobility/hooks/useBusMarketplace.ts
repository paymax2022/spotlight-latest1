// ── Bus provider marketplace — React Query hooks ─────────────────────────────
// Customer (search + directory) and provider (dashboard + management) hooks for
// the interstate bus marketplace. Mirrors useModes.ts conventions so screens
// stay declarative and share caching / loading / error contracts.
//
// Money: only customer booking (useBookBus in useModes.ts) charges. Provider
// route/schedule mutations are free management operations — no Idempotency-Key.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as bus from '../api/bus.api';
import * as provider from '../api/busProvider.api';
import { BUS_KEY } from '../constants/modes.constants';
import { toMobilityError } from '../utils/mobilityFormatters';
import type {
  BusSearchParams,
  BusProviderRegisterRequest,
  BusProviderUpdateRequest,
  BusRouteCreateRequest,
  BusRouteUpdateRequest,
  BusScheduleCreateRequest,
  BusTemplateCreateRequest,
} from '../types/busProvider.types';

const MKT_KEY = 'busmkt';
const PROV_KEY = 'busprov';

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER — search + directory
// ═══════════════════════════════════════════════════════════════════════════════
export function useBusSearch(params: BusSearchParams, enabled: boolean) {
  return useQuery({
    queryKey: [BUS_KEY, MKT_KEY, 'search', params.tripKind ?? '', params.fromState, params.toState, params.fromCity ?? '', params.toCity ?? '', params.providerId ?? '', params.date ?? ''],
    queryFn: () => bus.searchTrips(params),
    enabled,
    staleTime: 30_000,
  });
}

export function useBusProviders(state?: string, q?: string) {
  return useQuery({
    queryKey: [BUS_KEY, MKT_KEY, 'providers', state ?? '', q ?? ''],
    queryFn: () => bus.listProviders(state, q),
    staleTime: 30_000,
  });
}

export function useBusProviderDetail(id?: string) {
  return useQuery({
    queryKey: [BUS_KEY, MKT_KEY, 'provider', id],
    queryFn: () => bus.getProviderDetail(id as string),
    enabled: Boolean(id),
    staleTime: 20_000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER — dashboard + management (free operations, no money movement)
// ═══════════════════════════════════════════════════════════════════════════════
export function useProviderMe() {
  return useQuery({
    queryKey: [BUS_KEY, PROV_KEY, 'me'],
    queryFn: provider.getProviderMe,
    staleTime: 15_000,
  });
}

export function useRegisterProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: BusProviderRegisterRequest) => provider.registerProvider(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: [BUS_KEY, PROV_KEY] }),
    onError: (e) => { throw toMobilityError(e); },
  });
}

export function useUpdateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: BusProviderUpdateRequest) => provider.updateProvider(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: [BUS_KEY, PROV_KEY, 'me'] }),
    onError: (e) => { throw toMobilityError(e); },
  });
}

export function useCreateRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: BusRouteCreateRequest) => provider.createRoute(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [BUS_KEY, PROV_KEY, 'me'] });
      qc.invalidateQueries({ queryKey: [BUS_KEY, MKT_KEY] });
    },
    onError: (e) => { throw toMobilityError(e); },
  });
}

export function useUpdateRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...req }: BusRouteUpdateRequest & { id: string }) => provider.updateRoute(id, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [BUS_KEY, PROV_KEY, 'me'] });
      qc.invalidateQueries({ queryKey: [BUS_KEY, MKT_KEY] });
    },
    onError: (e) => { throw toMobilityError(e); },
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ routeId, ...req }: BusScheduleCreateRequest & { routeId: string }) => provider.createSchedule(routeId, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [BUS_KEY, PROV_KEY, 'me'] });
      qc.invalidateQueries({ queryKey: [BUS_KEY, MKT_KEY] });
    },
    onError: (e) => { throw toMobilityError(e); },
  });
}

// ─── Recurring departure templates ─────────────────────────────────────────────
const TPL_KEY = 'templates';

export function useTemplates() {
  return useQuery({
    queryKey: [BUS_KEY, PROV_KEY, TPL_KEY],
    queryFn: provider.listTemplates,
    staleTime: 15_000,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: BusTemplateCreateRequest) => provider.createTemplate(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [BUS_KEY, PROV_KEY, TPL_KEY] });
      qc.invalidateQueries({ queryKey: [BUS_KEY, MKT_KEY] });
    },
    onError: (e) => { throw toMobilityError(e); },
  });
}

export function useSetTemplateActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => provider.setTemplateActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: [BUS_KEY, PROV_KEY, TPL_KEY] }),
    onError: (e) => { throw toMobilityError(e); },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => provider.deleteTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [BUS_KEY, PROV_KEY, TPL_KEY] }),
    onError: (e) => { throw toMobilityError(e); },
  });
}

export function useProviderManifest(scheduleId?: string) {
  return useQuery({
    queryKey: [BUS_KEY, PROV_KEY, 'manifest', scheduleId],
    queryFn: () => provider.getManifest(scheduleId as string),
    enabled: Boolean(scheduleId),
    staleTime: 10_000,
  });
}
