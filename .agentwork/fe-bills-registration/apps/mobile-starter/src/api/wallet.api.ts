import { api } from '@/api/client';
import { mapTransactionFromApi } from '@/api/mappers/transaction.mapper';
import { mapWalletFromApi } from '@/api/mappers/wallet.mapper';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { Transaction, Wallet } from '@/types/billing';

export async function getWallet(): Promise<Wallet> {
  const response = await api.get('/api/v1/wallet/balance');
  return mapWalletFromApi(response.data?.data ?? response.data);
}

export async function getWalletTransactions(): Promise<Transaction[]> {
  const response = await api.get('/api/v1/wallet/transactions');
  const data = response.data?.data ?? response.data;
  const rows = Array.isArray(data) ? data : data?.transactions ?? data?.items ?? [];
  return rows.map(mapTransactionFromApi);
}

export interface TopupResult {
  alreadyProcessed: boolean;
  intentId: string;
  paymentReference: string;
  authorizationUrl: string;
  amountKobo: number;
}

export async function initiateWalletFunding(payload: { amountNaira: number }): Promise<TopupResult> {
  const amountKobo = Math.round(payload.amountNaira * 100);
  const idempotencyKey = generateIdempotencyKey();
  const response = await api.post(
    '/api/v1/wallet/topup',
    { amount_kobo: amountKobo },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  const data = response.data?.data ?? response.data;
  return {
    alreadyProcessed: Boolean(data.already_processed ?? data.alreadyProcessed),
    intentId: String(data.intent_id ?? data.intentId ?? ''),
    paymentReference: String(data.payment_reference ?? data.paymentReference ?? ''),
    authorizationUrl: String(data.authorization_url ?? data.authorizationUrl ?? ''),
    amountKobo,
  };
}
