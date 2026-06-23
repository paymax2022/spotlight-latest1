import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { generateIdempotencyKey } from '@/utils/idempotency';
import * as api from './api';
import type { CreateTaskInput, TaskStatus } from './types';

export const taskKeys = {
  all: ['tasks'] as const,
  list: () => [...taskKeys.all, 'list'] as const,
  detail: (id: string) => [...taskKeys.all, 'detail', id] as const,
};

export function useTasks() { return useQuery({ queryKey: taskKeys.list(), queryFn: api.listTasks }); }
export function useTask(id: string) { return useQuery({ queryKey: taskKeys.detail(id), queryFn: () => api.getTask(id), enabled: !!id }); }

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateTaskInput, 'idempotencyKey'>) => api.createTask({ ...input, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.list() }),
  });
}
export function useUpdateTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { taskId: string; status: TaskStatus }) => api.updateTaskStatus({ ...vars, idempotencyKey: generateIdempotencyKey() }),
    onSuccess: (t) => { qc.invalidateQueries({ queryKey: taskKeys.list() }); qc.invalidateQueries({ queryKey: taskKeys.detail(t.id) }); },
  });
}
