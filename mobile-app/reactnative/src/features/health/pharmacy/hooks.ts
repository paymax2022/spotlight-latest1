// ── Paymax Health — Pharmacy React Query hooks (Phase 1) ─────────────────────
// Declarative data hooks the pharmacy screens use. React Query v5.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProducts,
  getProduct,
  getPharmacies,
  getPharmacy,
  getPrescriptions,
  getPrescription,
  uploadPrescription,
  getOrders,
  getOrder,
  createOrder,
  reorder,
  getMedications,
  getRefills,
  scheduleRefill,
  getReviews,
  submitReview,
  getConsultThread,
  sendConsultMessage,
  getProviderOnboarding,
  submitProviderOnboarding,
  getProviderCatalog,
  getStockAlerts,
  getProviderOrders,
  dispenseOrder,
  handoffOrder,
  getProviderRxQueue,
  decideRx,
  getControlledLog,
  getProviderEarnings,
  requestPayout,
} from './api';
import type {
  ProductCategory,
  CreateOrderInput,
  SubmitReviewInput,
  ProviderOnboardingState,
  RxDecision,
} from './types';
import type { DiscoverPharmaciesOpts } from './api';

const KEY = 'pharmacy';

// ── Catalog ─────────────────────────────────────────────────────────────────
export function useProducts(opts?: { q?: string; category?: ProductCategory }) {
  return useQuery({
    queryKey: [KEY, 'products', opts ?? {}],
    queryFn: () => getProducts(opts),
    staleTime: 60_000,
  });
}

export function useProduct(id?: string) {
  return useQuery({
    queryKey: [KEY, 'product', id],
    queryFn: () => getProduct(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ── Pharmacies ──────────────────────────────────────────────────────────────
// opts.lat/lng (from useDeviceCoords) drive proximity sort; omit them to fall
// back to rating/name (see backend resolveSort, ADR-017).
export function usePharmacies(opts?: DiscoverPharmaciesOpts) {
  return useQuery({
    queryKey: [KEY, 'pharmacies', opts ?? {}],
    queryFn: () => getPharmacies(opts),
    staleTime: 60_000,
  });
}

export function usePharmacy(id?: string) {
  return useQuery({
    queryKey: [KEY, 'pharmacy', id],
    queryFn: () => getPharmacy(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ── Prescriptions ───────────────────────────────────────────────────────────
export function usePrescriptions() {
  return useQuery({ queryKey: [KEY, 'prescriptions'], queryFn: getPrescriptions, staleTime: 15_000 });
}

export function usePrescription(id?: string) {
  return useQuery({
    queryKey: [KEY, 'prescription', id],
    queryFn: () => getPrescription(id as string),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useUploadPrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { patientName: string; note?: string }) => uploadPrescription(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'prescriptions'] }),
  });
}

// ── Orders ──────────────────────────────────────────────────────────────────
export function useOrders() {
  return useQuery({ queryKey: [KEY, 'orders'], queryFn: getOrders, staleTime: 15_000 });
}

export function useOrder(id?: string) {
  return useQuery({
    queryKey: [KEY, 'order', id],
    queryFn: () => getOrder(id as string),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrderInput) => createOrder(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'orders'] }),
  });
}

export function useReorder() {
  return useMutation({ mutationFn: (orderId: string) => reorder(orderId) });
}

// ── Medications & refills ─────────────────────────────────────────────────────
export function useMedications() {
  return useQuery({ queryKey: [KEY, 'medications'], queryFn: getMedications, staleTime: 30_000 });
}

export function useRefills() {
  return useQuery({ queryKey: [KEY, 'refills'], queryFn: getRefills, staleTime: 30_000 });
}

export function useScheduleRefill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; autoRefill: boolean }) => scheduleRefill(args.id, args.autoRefill),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'refills'] }),
  });
}

// ── Ratings ─────────────────────────────────────────────────────────────────
export function useReviews(pharmacyId?: string) {
  return useQuery({
    queryKey: [KEY, 'reviews', pharmacyId ?? 'all'],
    queryFn: () => getReviews(pharmacyId),
    staleTime: 60_000,
  });
}

export function useSubmitReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitReviewInput) => submitReview(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'reviews'] }),
  });
}

// ── Pharmacist consult ────────────────────────────────────────────────────────
export function useConsultThread() {
  return useQuery({ queryKey: [KEY, 'consult-thread'], queryFn: getConsultThread, staleTime: 5_000 });
}

export function useSendConsultMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => sendConsultMessage(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'consult-thread'] }),
  });
}

// ── Provider: onboarding ──────────────────────────────────────────────────────
export function useProviderOnboarding() {
  return useQuery({ queryKey: [KEY, 'provider', 'onboarding'], queryFn: getProviderOnboarding, staleTime: 30_000 });
}

export function useSubmitProviderOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ProviderOnboardingState>) => submitProviderOnboarding(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'onboarding'] }),
  });
}

// ── Provider: catalog / stock ─────────────────────────────────────────────────
export function useProviderCatalog() {
  return useQuery({ queryKey: [KEY, 'provider', 'catalog'], queryFn: getProviderCatalog, staleTime: 30_000 });
}

export function useStockAlerts() {
  return useQuery({ queryKey: [KEY, 'provider', 'stock-alerts'], queryFn: getStockAlerts, staleTime: 30_000 });
}

// ── Provider: orders / dispense / handoff ─────────────────────────────────────
export function useProviderOrders() {
  return useQuery({ queryKey: [KEY, 'provider', 'orders'], queryFn: getProviderOrders, staleTime: 15_000 });
}

export function useDispenseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { orderId: string; idempotencyKey: string }) => dispenseOrder(args.orderId, args.idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'provider', 'orders'] });
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
    },
  });
}

export function useHandoffOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { orderId: string; mode: 'dispatch' | 'pickup'; idempotencyKey: string }) =>
      handoffOrder(args.orderId, args.mode, args.idempotencyKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'provider', 'orders'] });
      qc.invalidateQueries({ queryKey: [KEY, 'orders'] });
    },
  });
}

// ── Provider: Rx verification ─────────────────────────────────────────────────
export function useProviderRxQueue() {
  return useQuery({ queryKey: [KEY, 'provider', 'rx-queue'], queryFn: getProviderRxQueue, staleTime: 10_000 });
}

export function useDecideRx() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { rxId: string; decision: RxDecision; note?: string }) => decideRx(args.rxId, args.decision, args.note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'provider', 'rx-queue'] });
      qc.invalidateQueries({ queryKey: [KEY, 'prescriptions'] });
    },
  });
}

// ── Provider: controlled log ──────────────────────────────────────────────────
export function useControlledLog() {
  return useQuery({ queryKey: [KEY, 'provider', 'controlled-log'], queryFn: getControlledLog, staleTime: 60_000 });
}

// ── Provider: earnings & payouts ──────────────────────────────────────────────
export function useProviderEarnings() {
  return useQuery({ queryKey: [KEY, 'provider', 'earnings'], queryFn: getProviderEarnings, staleTime: 30_000 });
}

export function useRequestPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { amountKobo: number; idempotencyKey: string }) => requestPayout(args.amountKobo, args.idempotencyKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'provider', 'earnings'] }),
  });
}
