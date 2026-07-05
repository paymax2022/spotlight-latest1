// ── Paymax Mobility — Data hooks ─────────────────────────────────────────────
// React Query hooks mirroring useFx.ts so screens stay declarative and share
// caching / loading / error contracts. Money mutations attach Idempotency-Keys.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as mob from '../api/mobility.api';
import { MOBILITY_KEY as KEY } from '../constants/mobility.constants';
import { newIdempotencyKey, toMobilityError } from '../utils/mobilityFormatters';
import type {
  RideEstimateRequest,
  RideRequest,
  RateDraft,
  ServiceType,
  Kobo,
  LatLng,
  OnboardingSubmitDraft,
  DocumentDraft,
  DocType,
  VehicleDraft,
} from '../types/mobility.types';

// ─── Home / config / history ───────────────────────────────────────────────────
export function useMobilityHome() {
  return useQuery({ queryKey: [KEY, 'home'], queryFn: mob.getHome, staleTime: 15_000 });
}

export function usePricingConfig(serviceType: ServiceType, zone?: string) {
  return useQuery({
    queryKey: [KEY, 'pricing', serviceType, zone ?? 'default'],
    queryFn: () => mob.getPricingConfig(serviceType, zone),
    staleTime: 60_000,
  });
}

export function useHistory() {
  return useQuery({ queryKey: [KEY, 'history'], queryFn: mob.getHistory, staleTime: 30_000 });
}

// ─── Estimate ─────────────────────────────────────────────────────────────────
export function useRideEstimate() {
  return useMutation({
    mutationFn: (req: RideEstimateRequest) => mob.estimateRide(req),
    onError: (e) => { throw toMobilityError(e); },
  });
}

// ─── Request (money mutation → Idempotency-Key) ────────────────────────────────
export function useRideRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: Omit<RideRequest, 'idempotencyKey'>) =>
      mob.requestRide({ ...req, idempotencyKey: newIdempotencyKey('ride') }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'home'] });
      qc.invalidateQueries({ queryKey: [KEY, 'active'] });
    },
  });
}

// ─── Active trip (polled so the state machine advances) ────────────────────────
export function useActiveTrip(options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [KEY, 'active'],
    queryFn: mob.getActiveTrip,
    refetchInterval: options?.poll ? 4_000 : false,
    staleTime: 2_000,
  });
}

export function useTrip(tripId?: string, options?: { poll?: boolean }) {
  return useQuery({
    queryKey: [KEY, 'trip', tripId],
    queryFn: () => mob.getTrip(tripId as string),
    enabled: Boolean(tripId),
    refetchInterval: options?.poll ? 4_000 : false,
    staleTime: 2_000,
  });
}

export function useCancelRide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, reason }: { tripId: string; reason: string }) => mob.cancelRide(tripId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'active'] });
      qc.invalidateQueries({ queryKey: [KEY, 'home'] });
      qc.invalidateQueries({ queryKey: [KEY, 'history'] });
    },
  });
}

// ─── Fare negotiation ───────────────────────────────────────────────────────────
export function useFareNegotiation(tripId?: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [KEY, 'active'] });
    if (tripId) qc.invalidateQueries({ queryKey: [KEY, 'trip', tripId] });
  };

  const makeOffer = useMutation({
    mutationFn: ({ id, offerKobo }: { id: string; offerKobo: Kobo }) => mob.makeOffer(id, offerKobo),
    onError: (e) => { throw toMobilityError(e); },
    onSuccess: invalidate,
  });

  const acceptCounter = useMutation({
    mutationFn: (id: string) => mob.acceptCounter(id, newIdempotencyKey('counter')),
    onSuccess: invalidate,
  });

  return { makeOffer, acceptCounter };
}

// ─── Safety ───────────────────────────────────────────────────────────────────
export function useSafety(tripId?: string) {
  const qc = useQueryClient();

  const contacts = useQuery({ queryKey: [KEY, 'trusted-contacts'], queryFn: mob.getTrustedContacts, staleTime: 60_000 });

  const addContact = useMutation({
    mutationFn: ({ name, phone }: { name: string; phone: string }) => mob.addTrustedContact(name, phone),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'trusted-contacts'] }),
  });

  const deleteContact = useMutation({
    mutationFn: (id: string) => mob.deleteTrustedContact(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'trusted-contacts'] }),
  });

  const shareTrip = useMutation({
    mutationFn: (id: string) => mob.shareTrip(id),
    onSuccess: () => { if (tripId) qc.invalidateQueries({ queryKey: [KEY, 'trip', tripId] }); },
  });

  const sos = useMutation({
    mutationFn: ({ id, loc, description }: { id: string; loc: LatLng; description?: string }) =>
      mob.triggerSos(id, loc, description),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'active'] });
      if (tripId) qc.invalidateQueries({ queryKey: [KEY, 'trip', tripId] });
    },
  });

  return { contacts, addContact, deleteContact, shareTrip, sos };
}

// ─── Rating (tip = money mutation → Idempotency-Key) ───────────────────────────
export function useRateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, draft }: { tripId: string; draft: RateDraft }) =>
      mob.rateTrip(tripId, draft, newIdempotencyKey('rate')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'history'] });
      qc.invalidateQueries({ queryKey: [KEY, 'active'] });
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// DRIVER hooks
// ═══════════════════════════════════════════════════════════════════════════════

export function useDriverMe() {
  return useQuery({ queryKey: [KEY, 'driver', 'me'], queryFn: mob.getDriverMe, staleTime: 15_000 });
}

/** Driver home: profile + go online/offline toggle. */
export function useDriverHome() {
  const qc = useQueryClient();
  const me = useDriverMe();

  const setStatus = useMutation({
    mutationFn: ({ status, loc }: { status: 'online' | 'offline'; loc?: LatLng }) => mob.setDriverStatus(status, loc),
    onError: (e) => { throw toMobilityError(e); },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'driver', 'me'] }),
  });

  return { me, setStatus };
}

export function useDriverOnboarding() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: [KEY, 'driver', 'me'] });

  const submit = useMutation({
    mutationFn: (draft: OnboardingSubmitDraft) => mob.submitDriverOnboarding(draft),
    onSuccess: invalidate,
  });
  const uploadDoc = useMutation({
    mutationFn: (draft: DocumentDraft) => mob.uploadDriverDocument(draft),
    onSuccess: invalidate,
  });
  // Real upload: pick → R2 presign → PUT → submit object key. Prefer this over
  // uploadDoc (which takes an already-hosted fileUrl) from the onboarding screen.
  const uploadDocFile = useMutation({
    mutationFn: (input: {
      docType: DocType;
      file: { uri: string; name: string; mimeType: string };
      expiryDate?: string;
    }) => mob.uploadDriverDocumentFile(input),
    onSuccess: invalidate,
  });
  const addVehicle = useMutation({
    mutationFn: (draft: VehicleDraft) => mob.addDriverVehicle(draft),
    onSuccess: invalidate,
  });

  return { submit, uploadDoc, uploadDocFile, addVehicle };
}

export function useDriverRequests(options?: { poll?: boolean; enabled?: boolean }) {
  return useQuery({
    queryKey: [KEY, 'driver', 'requests'],
    queryFn: mob.getDriverRequests,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.poll ? 5_000 : false,
    staleTime: 3_000,
  });
}

/** Driver-side trip controls: accept / counter / arrive / verify-pin / start / complete. */
export function useDriverTrip() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [KEY, 'driver', 'requests'] });
    qc.invalidateQueries({ queryKey: [KEY, 'driver', 'earnings'] });
  };

  const accept = useMutation({
    mutationFn: (tripId: string) => mob.acceptDriverRequest(tripId, newIdempotencyKey('drv-accept')),
    onSuccess: invalidate,
  });
  const counter = useMutation({
    mutationFn: ({ tripId, counterKobo }: { tripId: string; counterKobo: Kobo }) => mob.counterDriverRequest(tripId, counterKobo),
    onError: (e) => { throw toMobilityError(e); },
  });
  const arrive = useMutation({ mutationFn: (tripId: string) => mob.driverArrive(tripId) });
  const verifyPin = useMutation({
    mutationFn: ({ tripId, pin }: { tripId: string; pin: string }) => mob.driverVerifyPin(tripId, pin),
    onError: (e) => { throw toMobilityError(e); },
  });
  const start = useMutation({ mutationFn: (tripId: string) => mob.driverStart(tripId) });
  const complete = useMutation({ mutationFn: (tripId: string) => mob.driverComplete(tripId), onSuccess: invalidate });

  return { accept, counter, arrive, verifyPin, start, complete };
}

export function useDriverEarnings() {
  return useQuery({ queryKey: [KEY, 'driver', 'earnings'], queryFn: mob.getDriverEarnings, staleTime: 20_000 });
}
