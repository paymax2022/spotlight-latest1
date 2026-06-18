import axios from 'axios';
const api = axios.create({ baseURL: process.env.EXPO_PUBLIC_API_URL + '/api' });
export interface Task { id: string; title: string; description?: string; assignee_name?: string; created_by_name: string; due_date?: string; priority: 'low'|'medium'|'high'; status: 'todo'|'in_progress'|'done'|'overdue'; estate_id: string; }
export const listTasks = (estateId: string, filter?: string) => api.get(`/estates/${estateId}/tasks`, { params: { filter } }).then(r => r.data as Task[]);
export const getTask = (id: string, estateId: string) => api.get(`/estates/${estateId}/tasks/${id}`).then(r => r.data as Task);
export const createTask = (estateId: string, body: Partial<Task>) => api.post(`/estates/${estateId}/tasks`, body).then(r => r.data as Task);
export const updateTaskStatus = (id: string, estateId: string, status: string) => api.patch(`/estates/${estateId}/tasks/${id}`, { status }).then(r => r.data);
