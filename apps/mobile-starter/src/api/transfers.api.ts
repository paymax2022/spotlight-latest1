import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type { TransferPayload, TransferResult } from '@/types/fintech';

export interface Bank {
  code: string;
  name: string;
}

export async function listBanks(): Promise<Bank[]> {
  const response = await api.get('/api/v1/transfers/banks');
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.banks ?? [];
}

export async function resolveAccount(params: {
  account_number: string;
  bank_code: string;
}): Promise<{ account_name: string; account_number: string }> {
  const response = await api.get('/api/v1/transfers/resolve', { params });
  return response.data?.data ?? response.data;
}

export async function initiateTransfer(payload: TransferPayload): Promise<TransferResult> {
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post('/api/v1/transfers', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data?.data ?? response.data;
}

export async function listTransferHistory(params?: {
  limit?: number;
  offset?: number;
}): Promise<TransferResult[]> {
  const response = await api.get('/api/v1/transfers', { params });
  const data = response.data?.data ?? response.data;
  return Array.isArray(data) ? data : data?.transfers ?? [];
}
