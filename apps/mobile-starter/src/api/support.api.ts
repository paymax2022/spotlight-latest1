import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { SupportTicket } from '@/types/fintech';

export async function listMyTickets(): Promise<SupportTicket[]> {
  const response = await api.get('/api/v1/support/tickets');
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.tickets ?? [];
}

export async function openTicket(payload: {
  subject: string;
  message: string;
}): Promise<SupportTicket> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post('/api/v1/support/tickets', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data?.data ?? response.data;
}
