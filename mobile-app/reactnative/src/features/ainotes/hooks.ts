import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { GenerateNoteInput } from './api';

export const aiNoteKeys = { all: ['ainotes'] as const, list: () => [...aiNoteKeys.all, 'list'] as const };

export function useAiNotes() { return useQuery({ queryKey: aiNoteKeys.list(), queryFn: api.listAiNotes }); }

export function useGenerateAiNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateNoteInput) => api.generateAiNote(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiNoteKeys.list() }),
  });
}
