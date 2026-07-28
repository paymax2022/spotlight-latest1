// ── Spotlight Realtor — Owner hooks (V2) ─────────────────────────────────────
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as owner from '../api/realtorOwner.api';
import type { CreatePropertyDraft, CreateUnitDraft, OfferingModeConfig } from '../types/realtor.owner.types';

const KEY = 'realtor-owner';

export function useOwnerDashboard() {
  return useQuery({ queryKey: [KEY, 'dashboard'], queryFn: owner.getOwnerDashboard, staleTime: 30_000 });
}

export function useCreateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: CreatePropertyDraft) => owner.createProperty(d),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'dashboard'] }),
  });
}

export function useCreateUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: CreateUnitDraft) => owner.createUnit(d),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, 'dashboard'] }),
  });
}

export function useUnitOfferings(unitId: string) {
  return useQuery({ queryKey: [KEY, 'offerings', unitId], queryFn: () => owner.getUnitOfferings(unitId), enabled: !!unitId });
}

export function useSaveUnitOfferings(unitId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modes: OfferingModeConfig[]) => owner.saveUnitOfferings(unitId, modes),
    onSuccess: (u) => qc.setQueryData([KEY, 'offerings', unitId], u),
  });
}

export function useVoidCandidates() {
  return useQuery({ queryKey: [KEY, 'void'], queryFn: owner.getVoidCandidates, staleTime: 20_000 });
}

export function useSetVoidShortlet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ unitId, enabled }: { unitId: string; enabled: boolean }) => owner.setVoidShortlet(unitId, enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'void'] });
      qc.invalidateQueries({ queryKey: [KEY, 'dashboard'] });
    },
  });
}
