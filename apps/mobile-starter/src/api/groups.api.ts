import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { Group, GroupContribution } from '@/types/fintech';

export async function listMyGroups(): Promise<Group[]> {
  const response = await api.get('/api/v1/groups');
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.groups ?? [];
}

export async function getGroup(id: string): Promise<Group> {
  const response = await api.get(`/api/v1/groups/${id}`);
  return response.data?.data ?? response.data;
}

export async function createGroup(payload: {
  name: string;
  description: string;
  is_private: boolean;
  category: string;
}): Promise<Group> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post('/api/v1/groups', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data?.data ?? response.data;
}

export async function contributeToGroup(payload: GroupContribution): Promise<{ reference: string }> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post(`/api/v1/groups/${payload.group_id}/contribute`, payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data?.data ?? response.data;
}
