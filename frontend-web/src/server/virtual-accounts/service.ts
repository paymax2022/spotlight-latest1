import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';

export interface VirtualAccountRow {
  id: string;
  user_id: string;
  provider: string;
  customer_code: string | null;
  account_number: string;
  account_name: string;
  bank_name: string;
  bank_code: string;
  currency: string;
  provisioned_at: string;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getVirtualAccount(userId: string): Promise<VirtualAccountRow | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('virtual_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'paystack')
    .eq('currency', 'NGN')
    .maybeSingle();

  if (error) throw new ApiError('Failed to fetch virtual account', 500);
  return data ? (data as unknown as VirtualAccountRow) : null;
}

// ---------------------------------------------------------------------------
// Provision
// ---------------------------------------------------------------------------

/**
 * Provision a Paystack Dedicated Virtual Account for a user.
 * Idempotent — returns the existing account if already provisioned.
 * Requires KYC tier 1 (enforced by the caller: requireKycTier(userId, 1)).
 *
 * Auto-trigger: this function should be called by the admin KYC approval route
 * after setting kyc_tier to 1. See docs/adr/ADR-003.
 */
export async function provisionVirtualAccount(
  userId: string,
  userEmail: string,
  firstName: string,
  lastName: string,
): Promise<VirtualAccountRow> {
  // Idempotency — return existing account
  const existing = await getVirtualAccount(userId);
  if (existing) return existing;

  // Step 1: Create or find the Paystack customer
  const customerCode = await ensurePaystackCustomer(userEmail, firstName, lastName);

  // Step 2: Create the Dedicated Virtual Account
  const dvaData = await createPaystackDva(customerCode);

  // Step 3: Persist to DB
  // Generate id client-side so we can return the row without a post-insert SELECT.
  const supabase = createAdminClient();
  const newId = crypto.randomUUID();
  const provisionedAt = new Date().toISOString();

  const { error } = await supabase.from('virtual_accounts').insert({
    id: newId,
    user_id: userId,
    provider: 'paystack',
    customer_code: customerCode,
    account_number: dvaData.account_number,
    account_name: dvaData.account_name,
    bank_name: dvaData.bank_name,
    bank_code: dvaData.bank_code,
    currency: 'NGN',
    provisioned_at: provisionedAt,
  });

  if (error) {
    // Race: another request provisioned concurrently — re-fetch
    if (error.code === '23505') {
      const raced = await getVirtualAccount(userId);
      if (raced) return raced;
    }
    throw new ApiError(`Failed to save virtual account: ${error.message}`, 500);
  }

  return {
    id: newId,
    user_id: userId,
    provider: 'paystack',
    customer_code: customerCode,
    account_number: dvaData.account_number,
    account_name: dvaData.account_name,
    bank_name: dvaData.bank_name,
    bank_code: dvaData.bank_code,
    currency: 'NGN',
    provisioned_at: provisionedAt,
  };
}

// ---------------------------------------------------------------------------
// Lookup by account number (for DVA inbound transfer webhook)
// ---------------------------------------------------------------------------

export async function getVirtualAccountByNumber(
  accountNumber: string,
): Promise<VirtualAccountRow | null> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from('virtual_accounts')
    .select('*')
    .eq('account_number', accountNumber)
    .eq('provider', 'paystack')
    .maybeSingle();

  return data ? (data as unknown as VirtualAccountRow) : null;
}

// ---------------------------------------------------------------------------
// Paystack API helpers (DVA-owned, independent of voting module)
// ---------------------------------------------------------------------------

function getPaystackSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new ApiError('Paystack is not configured', 500);
  return key;
}

async function paystackPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getPaystackSecretKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(`Paystack API error (${path}): ${text}`, 502);
  }

  return res.json() as Promise<T>;
}

async function ensurePaystackCustomer(
  email: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const result = await paystackPost<{ status: boolean; data: { customer_code: string } }>(
    '/customer',
    { email, first_name: firstName, last_name: lastName },
  );

  if (!result.status || !result.data?.customer_code) {
    throw new ApiError('Paystack did not return a customer code', 502);
  }

  return result.data.customer_code;
}

interface DvaResult {
  account_number: string;
  account_name: string;
  bank_name: string;
  bank_code: string;
}

async function createPaystackDva(customerCode: string): Promise<DvaResult> {
  const preferredBank = process.env.PAYSTACK_DVA_BANK ?? 'wema-bank';

  const result = await paystackPost<{
    status: boolean;
    data: {
      account_number: string;
      account_name: string;
      bank: { name: string; id: number; slug: string };
    };
  }>('/dedicated_account', {
    customer: customerCode,
    preferred_bank: preferredBank,
  });

  if (!result.status || !result.data?.account_number) {
    throw new ApiError('Paystack did not return a virtual account number', 502);
  }

  return {
    account_number: result.data.account_number,
    account_name: result.data.account_name,
    bank_name: result.data.bank.name,
    bank_code: String(result.data.bank.id),
  };
}
