import { api } from '@/api/client';
import { mapReceiptFromApi, mapTransactionFromApi } from '@/api/mappers/transaction.mapper';
import { Receipt, ServiceType, Transaction, TransactionStatus } from '@/types/billing';

export async function getTransactions(params?: {
  serviceType?: ServiceType;
  status?: TransactionStatus;
  page?: number;
  limit?: number;
}): Promise<{ items: Transaction[]; nextPage?: number | null }> {
  const response = await api.get('/api/v1/utility/transactions', { params });
  const data = response.data?.data ?? response.data;
  const rows = Array.isArray(data) ? data : data?.transactions ?? data?.items ?? [];
  return {
    items: rows.map(mapTransactionFromApi),
    nextPage: data?.nextPage ?? data?.next_page ?? null,
  };
}

export async function getTransaction(id: string): Promise<Transaction> {
  const response = await api.get(`/api/v1/utility/transactions/${id}`);
  const data = response.data?.data ?? response.data;
  return mapTransactionFromApi(data?.transaction ?? data);
}

export async function getReceipt(id: string): Promise<Receipt> {
  const response = await api.get(`/api/v1/utility/transactions/${id}/receipt`);
  return mapReceiptFromApi(response.data?.data ?? response.data);
}

export async function retryTransaction(id: string) {
  const response = await api.post(`/api/v1/utility/transactions/${id}/requery`);
  return response.data?.data ?? response.data;
}
