import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { CreateDocumentInput } from './api';

export const documentKeys = { all: ['documents'] as const, list: () => [...documentKeys.all, 'list'] as const };

export function useDocuments() { return useQuery({ queryKey: documentKeys.list(), queryFn: api.listDocuments }); }

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDocumentInput) => api.createDocument(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.list() }),
  });
}
