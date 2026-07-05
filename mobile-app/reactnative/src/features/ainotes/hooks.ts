import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { GenerateNoteInput } from './api';

export const aiNoteKeys = {
  all: ['ainotes'] as const,
  list: () => [...aiNoteKeys.all, 'list'] as const,
  detail: (id: string) => [...aiNoteKeys.all, 'detail', id] as const,
};

export function useAiNotes() {
  return useQuery({ queryKey: aiNoteKeys.list(), queryFn: api.listAiNotes });
}

export function useAiNote(id: string) {
  return useQuery({ queryKey: aiNoteKeys.detail(id), queryFn: () => api.getAiNote(id), enabled: !!id });
}

export function useGenerateAiNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateNoteInput) => api.generateAiNote(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiNoteKeys.list() }),
  });
}

export function useApproveAiNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.approveAiNote(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiNoteKeys.all }),
  });
}
