export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface EstateTask {
  id: string;
  estateId: string;
  title: string;
  description?: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  createdBy: string;
  dueDate?: string | null;     // ISO
  priority: TaskPriority;
  status: TaskStatus;
  createdAt: string;           // ISO
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority: TaskPriority;
  dueDate?: string | null;
  idempotencyKey: string;
}

export interface UpdateTaskStatusInput {
  taskId: string;
  status: TaskStatus;
  idempotencyKey: string;
}
