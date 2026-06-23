import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { MemberSettings } from './api';

export const settingsKeys = { all: ['estatesettings'] as const, current: () => [...settingsKeys.all, 'current'] as const };

export function useSettings() { return useQuery({ queryKey: settingsKeys.current(), queryFn: api.getSettings }); }

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<MemberSettings>) => api.updateSettings(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: settingsKeys.current() });
      const prev = qc.getQueryData<MemberSettings>(settingsKeys.current());
      if (prev) qc.setQueryData(settingsKeys.current(), { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _patch, ctx) => { if (ctx?.prev) qc.setQueryData(settingsKeys.current(), ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.current() }),
  });
}
