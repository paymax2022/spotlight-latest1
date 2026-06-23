import { createSupabaseClient } from '@/lib/supabase';
import { api } from '@/api/client';
import { mapTransactionFromSupabase, mapReceiptFromSupabase } from '@/api/mappers/transaction.mapper';
import { Transaction, Receipt, TransactionStatus } from '@/types/transaction';

export interface TransactionListParams {
  serviceType?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// App status → Supabase status values (for filtering)
const APP_TO_DB_STATUS: Record<string, string[]> = {
  PROCESSING: ['initiated', 'wallet_debited'],
  PENDING:    ['provider_pending'],
  SUCCESSFUL: ['successful'],
  FAILED:     ['failed', 'disputed'],
  REVERSED:   ['reversed'],
};

// App serviceType → Supabase category (for filtering)
const APP_TO_DB_CATEGORY: Record<string, string> = {
  AIRTIME:     'airtime',
  DATA:        'data',
  ELECTRICITY: 'electricity',
  CABLE_TV:    'cable_tv',
  EDUCATION:   'education',
};

const TX_SELECT = `
  *,
  biller:utility_billers!biller_id(name),
  product:utility_products!product_id(name)
`.trim();

export async function getTransactions(params?: TransactionListParams): Promise<TransactionPage> {
  const supabase = createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const limit = params?.limit ?? 20;
  const page  = params?.page  ?? 1;

  let query = supabase
    .from('utility_transactions')
    .select(TX_SELECT, { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (params?.serviceType) {
    const cat = APP_TO_DB_CATEGORY[params.serviceType];
    if (cat) query = query.eq('category', cat);
  }

  if (params?.status) {
    const statuses = APP_TO_DB_STATUS[params.status as TransactionStatus];
    if (statuses?.length) query = query.in('status', statuses);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const items = (data ?? []).map(mapTransactionFromSupabase);
  return {
    items,
    total:   count ?? items.length,
    page,
    limit,
    hasMore: items.length === limit,
  };
}

export async function getTransactionById(id: string): Promise<Transaction> {
  const supabase = createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('utility_transactions')
    .select(TX_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error) throw error;
  return mapTransactionFromSupabase(data);
}

// Receipt is the same row as the transaction; exposed via a separate function
// so the receipt screen can call it independently.
export async function getReceipt(id: string): Promise<Receipt> {
  const supabase = createSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('utility_transactions')
    .select(TX_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error) throw error;
  return mapReceiptFromSupabase(data);
}

// Retry is a server-side operation (re-queues the provider call).
export async function retryTransaction(id: string): Promise<{ transactionId: string }> {
  const res  = await api.post(`/api/bills/transactions/${id}/retry`);
  const data = (res.data?.data ?? res.data) as Record<string, unknown>;
  return { transactionId: String(data.transactionId ?? data.transaction_id ?? id) };
}
