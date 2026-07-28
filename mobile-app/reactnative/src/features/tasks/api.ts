// Estate Tasks API (Block 31) — dual mock/live behind USE_MOCK.
import { api } from '@/api/client';
import { Colors } from '@/constants/colors';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { CreateTaskInput, EstateTask, TaskPriority, TaskStatus, UpdateTaskStatusInput } from './types';

export const USE_MOCK = (process.env.EXPO_PUBLIC_TASKS_USE_MOCK ?? 'true') !== 'false';

// Tasks are served by the resident-scoped frontend-web handlers under
// /api/v1/estate/tasks (GET list, POST create, GET /{id}, POST /{id}/status).
// The current resident's estate is derived SERVER-SIDE from the auth token
// (frontend-web/src/server/estate/resident.ts → getResidentContext), so the
// client never passes an estate ID.
export const TASKS_API_BASE = '/api/v1/estate/tasks';

export const TaskColors: Record<TaskStatus, { color: string; bg: string }> = {
  todo:        { color: Colors.outline,   bg: 'rgba(123,116,131,0.12)' },
  in_progress: { color: Colors.secondary, bg: Colors.iconBgBlue },
  done:        { color: '#16A34A',        bg: 'rgba(22,163,74,0.12)' },
};
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
export const PRIORITY_META: Record<TaskPriority, { label: string; color: string; bg: string }> = {
  low:    { label: 'Low',    color: Colors.teal,      bg: Colors.iconBgTeal },
  medium: { label: 'Medium', color: '#B26B00',        bg: 'rgba(245,158,11,0.12)' },
  high:   { label: 'High',   color: Colors.error,     bg: Colors.errorContainer },
};

const H = 3_600_000, D = 24 * H, iso = (o: number) => new Date(Date.now() + o).toISOString();
let tasks: EstateTask[] = [
  { id: 't1', estateId: 'est_amber_court', title: 'Replace Gate B intercom', description: 'Intercom static since last week.', assigneeName: 'Facility Team', createdBy: 'res_2', dueDate: iso(2 * D), priority: 'high', status: 'in_progress', createdAt: iso(-2 * D) },
  { id: 't2', estateId: 'est_amber_court', title: 'Circulate Q3 meeting agenda', assigneeName: 'Ngozi Okeke', createdBy: 'res_2', dueDate: iso(D), priority: 'medium', status: 'todo', createdAt: iso(-1 * D) },
  { id: 't3', estateId: 'est_amber_court', title: 'Audit waste-disposal invoices', createdBy: 'res_3', dueDate: iso(-1 * D), priority: 'low', status: 'done', createdAt: iso(-5 * D) },
];
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const idem = (k?: string) => ({ headers: { 'Idempotency-Key': k ?? generateIdempotencyKey() } });

export async function listTasks(): Promise<EstateTask[]> {
  if (USE_MOCK) { await latency(); return tasks.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)); }
  const { data } = await api.get<EstateTask[]>(TASKS_API_BASE); return data;
}
// NOTE: the backend route table has no GET /:id/tasks/:taskId (single-task
// read) — only GET /:id/tasks (list) and PATCH .../status exist. Derive the
// single task from the list response rather than hitting a 404 endpoint
// (mirrors events.api.ts getTicket()); see report for the missing endpoint.
export async function getTask(id: string): Promise<EstateTask> {
  if (USE_MOCK) { await latency(200); const t = tasks.find((x) => x.id === id); if (!t) throw new Error('Task not found'); return { ...t }; }
  const all = await listTasks();
  const t = all.find((x) => x.id === id);
  if (!t) throw new Error('Task not found');
  return t;
}
export async function createTask(input: CreateTaskInput): Promise<EstateTask> {
  if (USE_MOCK) {
    await latency(400);
    const t: EstateTask = { id: `t_${Date.now()}`, estateId: 'est_amber_court', title: input.title.trim(), description: input.description?.trim() || undefined, assigneeName: null, createdBy: 'res_demo', dueDate: input.dueDate ?? null, priority: input.priority, status: 'todo', createdAt: new Date().toISOString() };
    tasks = [t, ...tasks]; return { ...t };
  }
  const { data } = await api.post<EstateTask>(TASKS_API_BASE, input, idem(input.idempotencyKey)); return data;
}
export async function updateTaskStatus(input: UpdateTaskStatusInput): Promise<EstateTask> {
  if (USE_MOCK) { await latency(250); const t = tasks.find((x) => x.id === input.taskId); if (!t) throw new Error('Task not found'); t.status = input.status; return { ...t }; }
  const { data } = await api.post<EstateTask>(`${TASKS_API_BASE}/${input.taskId}/status`, { status: input.status }, idem(input.idempotencyKey)); return data;
}
