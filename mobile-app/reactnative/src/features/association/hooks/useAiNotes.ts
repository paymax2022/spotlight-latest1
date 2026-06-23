// ── Association — AI note-taking hooks (L) ────────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAiNotes, getAiNote, createAiNote, awaitProcessing,
  approveAiNote, publishAiNote, convertActionItem, regenerateSummary,
} from '../api/ainotes.api';
import type { CreateAiNoteInput } from '../types/ainotes.types';

const KEY = 'association';

export function useAiNotes() {
  return useQuery({ queryKey: [KEY, 'aiNotes'], queryFn: getAiNotes, staleTime: 20_000 });
}

export function useAiNote(id?: string) {
  return useQuery({
    queryKey: [KEY, 'aiNote', id],
    queryFn: () => getAiNote(id as string),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useCreateAiNote() {
  return useMutation({ mutationFn: (input: CreateAiNoteInput) => createAiNote(input) });
}

export function useAwaitProcessing() {
  return useMutation({ mutationFn: (id: string) => awaitProcessing(id) });
}

export function useRegenerateSummary() {
  return useMutation({ mutationFn: (id: string) => regenerateSummary(id) });
}

export function useApproveAiNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approveAiNote(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'aiNote', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'aiNotes'] });
    },
  });
}

export function usePublishAiNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => publishAiNote(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: [KEY, 'aiNote', id] });
      qc.invalidateQueries({ queryKey: [KEY, 'aiNotes'] });
    },
  });
}

export function useConvertActionItem(noteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (actionItemId: string) => convertActionItem(noteId, actionItemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, 'aiNote', noteId] });
      qc.invalidateQueries({ queryKey: [KEY, 'tasks'] });
    },
  });
}
