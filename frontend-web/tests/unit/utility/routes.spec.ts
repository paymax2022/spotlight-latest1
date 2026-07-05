import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest, withAuth } from '../golden-path/_fixtures';

vi.mock('@/src/lib/feature-flags', () => ({
  featureFlags: {
    utilityPayments: vi.fn(() => true),
  },
}));

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(),
}));

vi.mock('@/src/server/kyc/gate', () => ({
  requireKycTier: vi.fn(),
}));

vi.mock('@/src/server/admin/auth', () => ({
  assertAdminPermission: vi.fn(),
}));

vi.mock('@/src/server/admin/audit', () => ({
  addAuditEvent: vi.fn(),
}));

vi.mock('@/src/lib/voting/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 9, resetInMs: 60_000 })),
}));

vi.mock('@/src/server/utility/service', () => ({
  listUtilityCategories: vi.fn(),
  listBillers: vi.fn(),
  listProducts: vi.fn(),
  validateUtilityCustomer: vi.fn(),
  payUtility: vi.fn(),
  listUserUtilityTransactions: vi.fn(),
  getUserUtilityTransaction: vi.fn(),
  requeryUtilityTransaction: vi.fn(),
  createUtilityDispute: vi.fn(),
  listUtilityBeneficiaries: vi.fn(),
  saveUtilityBeneficiary: vi.fn(),
  deleteUtilityBeneficiary: vi.fn(),
  adminCreateUtilityRow: vi.fn(),
  adminListUtilityTable: vi.fn(),
  adminUpdateUtilityRow: vi.fn(),
  adminHealthCheckProvider: vi.fn(),
  adminListUtilityTransactions: vi.fn(),
  adminGetUtilityTransaction: vi.fn(),
  reverseUtilityTransaction: vi.fn(),
  adminResolveUtilityDispute: vi.fn(),
  adminUtilityReport: vi.fn(),
  requeryPendingUtilityTransactions: vi.fn(),
}));

import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { requireKycTier } from '@/src/server/kyc/gate';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import { checkRateLimit } from '@/src/lib/voting/rate-limit';
import {
  adminCreateUtilityRow,
  adminGetUtilityTransaction,
  adminListUtilityTable,
  adminUpdateUtilityRow,
  adminUtilityReport,
  listUtilityCategories,
  payUtility,
  requeryPendingUtilityTransactions,
  reverseUtilityTransaction,
} from '@/src/server/utility/service';
import { GET as getCategories } from '../../../app/api/v1/utility/categories/route';
import { POST as postPay } from '../../../app/api/v1/utility/pay/route';
import { GET as listProviders, POST as createProvider } from '../../../app/api/admin/utility/providers/route';
import { GET as listAdminCategories } from '../../../app/api/admin/utility/categories/route';
import { PATCH as updateAdminCategory } from '../../../app/api/admin/utility/categories/[category]/route';
import { POST as reverseAdminTransaction } from '../../../app/api/admin/utility/transactions/[id]/reverse/route';
import { GET as getProfitabilityReport } from '../../../app/api/admin/utility/reports/profitability/route';
import { POST as requeryPendingWorker } from '../../../app/api/admin/utility/workers/requery-pending/route';
import { PUT as rotateProviderCredentials } from '../../../app/api/admin/utility/providers/[id]/credentials/route';

const TEST_USER = { id: 'user-utility-001', email: 'utility@example.com' };

describe('utility customer routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.utilityPayments).mockReturnValue(true);
    vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER);
    vi.mocked(requireKycTier).mockResolvedValue(undefined);
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 9, resetInMs: 60_000 });
  });

  it('gates routes when the feature flag is disabled', async () => {
    vi.mocked(featureFlags.utilityPayments).mockReturnValue(false);

    const response = await getCategories(new Request('http://localhost/api/v1/utility/categories', {
      headers: withAuth(),
    }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.success).toBe(false);
  });

  it('returns utility categories for an authenticated user (auth-only, no KYC tier gate)', async () => {
    vi.mocked(listUtilityCategories).mockResolvedValue([{ id: 'airtime', label: 'Airtime' }]);

    const response = await getCategories(new Request('http://localhost/api/v1/utility/categories', {
      headers: withAuth(),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.categories).toHaveLength(1);
    expect(requireRequestUser).toHaveBeenCalled();
    // KYC Tier-1 is intentionally NOT enforced in the utility module — per the
    // product decision documented in app/api/v1/utility/_utils.ts.
    expect(requireKycTier).not.toHaveBeenCalled();
  });

  it('requires Idempotency-Key for utility payments', async () => {
    const response = await postPay(makeRequest('/api/v1/utility/pay', {
      body: { category: 'airtime' },
      headers: withAuth(),
    }));

    expect(response.status).toBe(400);
    expect(payUtility).not.toHaveBeenCalled();
  });

  it('creates a wallet-backed utility payment', async () => {
    vi.mocked(payUtility).mockResolvedValue({
      alreadyProcessed: false,
      transaction: { id: 'tx-001', status: 'successful', receipt_number: 'UTL-001' },
    } as any);

    const response = await postPay(makeRequest('/api/v1/utility/pay', {
      body: {
        category: 'airtime',
        biller_id: 'biller-001',
        product_id: 'product-001',
        customer_reference: '08030000000',
        amount_kobo: 100_000,
      },
      headers: withAuth({ 'Idempotency-Key': 'UTILITY-test-key' }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.transaction.receipt_number).toBe('UTL-001');
    expect(payUtility).toHaveBeenCalledWith(TEST_USER.id, expect.objectContaining({
      category: 'airtime',
      idempotencyKey: 'UTILITY-test-key',
    }));
  });

  it('rate-limits utility payment attempts', async () => {
    vi.mocked(checkRateLimit).mockReturnValueOnce({ allowed: false, remaining: 0, resetInMs: 60_000 });

    const response = await postPay(makeRequest('/api/v1/utility/pay', {
      body: {
        category: 'airtime',
        biller_id: 'biller-001',
        product_id: 'product-001',
        customer_reference: '08030000000',
        amount_kobo: 100_000,
      },
      headers: withAuth({ 'Idempotency-Key': 'UTILITY-test-key' }),
    }));

    expect(response.status).toBe(429);
    expect(payUtility).not.toHaveBeenCalled();
  });
});

describe('utility admin routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.utilityPayments).mockReturnValue(true);
    vi.mocked(assertAdminPermission).mockResolvedValue({ role: 'super_admin', actorId: 'admin-001' } as any);
  });

  it('lists providers without requiring customer auth', async () => {
    vi.mocked(adminListUtilityTable).mockResolvedValue([{ id: 'provider-001', name: 'Sandbox' }]);

    const response = await listProviders(new Request('http://localhost/api/admin/utility/providers?limit=10'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.providers).toHaveLength(1);
    expect(assertAdminPermission).toHaveBeenCalledWith(expect.any(Request), 'utility:manage');
  });

  it('creates providers through the utility manager permission', async () => {
    vi.mocked(adminCreateUtilityRow).mockResolvedValue({ id: 'provider-001', name: 'Sandbox' });

    const response = await createProvider(makeRequest('/api/admin/utility/providers', {
      body: { name: 'Sandbox', code: 'sandbox', adapter_code: 'sandbox' },
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.provider.name).toBe('Sandbox');
    expect(addAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'utility.provider.create',
      module: 'utility_payments',
      adminUser: 'admin-001',
    }));
  });

  it('lists utility category controls', async () => {
    vi.mocked(adminListUtilityTable).mockResolvedValue([{ category: 'airtime', enabled: true }]);

    const response = await listAdminCategories(new Request('http://localhost/api/admin/utility/categories'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.categories[0].category).toBe('airtime');
    expect(adminListUtilityTable).toHaveBeenCalledWith('utility_category_settings', expect.any(Object));
  });

  it('updates utility category controls with audit logging', async () => {
    vi.mocked(adminUpdateUtilityRow).mockResolvedValue({ category: 'airtime', enabled: false });

    const response = await updateAdminCategory(makeRequest('/api/admin/utility/categories/airtime', {
      method: 'PATCH',
      body: { enabled: false, availability_message: 'Maintenance' },
    }), { params: { category: 'airtime' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.category.enabled).toBe(false);
    expect(adminUpdateUtilityRow).toHaveBeenCalledWith('utility_category_settings', 'airtime', expect.objectContaining({ enabled: false }));
    expect(addAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'utility.category.update',
      entityId: 'airtime',
    }));
  });

  it('reverses eligible transactions with an explicit reason', async () => {
    const transaction = { id: 'tx-001', status: 'failed', retail_amount_kobo: 100_000 };
    vi.mocked(adminGetUtilityTransaction).mockResolvedValue(transaction as any);
    vi.mocked(reverseUtilityTransaction).mockResolvedValue({ ...transaction, status: 'reversed' } as any);

    const response = await reverseAdminTransaction(makeRequest('/api/admin/utility/transactions/tx-001/reverse', {
      body: { reason: 'Provider failure confirmed' },
    }), { params: { id: 'tx-001' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.transaction.status).toBe('reversed');
    expect(reverseUtilityTransaction).toHaveBeenCalledWith(transaction, 'Provider failure confirmed');
    expect(addAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'utility.transaction.reverse',
      reason: 'Provider failure confirmed',
    }));
  });

  it('returns profitability reports to support roles', async () => {
    vi.mocked(adminUtilityReport).mockResolvedValue({
      total_transactions: 2,
      gross_transaction_value_kobo: 200_000,
      provider_cost_kobo: 150_000,
      gross_profit_kobo: 50_000,
    });

    const response = await getProfitabilityReport(new Request('http://localhost/api/admin/utility/reports/profitability'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.report.gross_profit_kobo).toBe(50_000);
    expect(assertAdminPermission).toHaveBeenCalledWith(expect.any(Request), 'utility:support');
  });

  it('exports profitability reports as CSV', async () => {
    vi.mocked(adminUtilityReport).mockResolvedValue({
      total_transactions: 2,
      gross_transaction_value_kobo: 200_000,
      provider_cost_kobo: 150_000,
      gross_profit_kobo: 50_000,
    });

    const response = await getProfitabilityReport(new Request('http://localhost/api/admin/utility/reports/profitability?format=csv'));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(body).toContain('gross_profit_kobo');
  });

  it('runs the pending requery worker with audit logging', async () => {
    vi.mocked(requeryPendingUtilityTransactions).mockResolvedValue({
      processed: 2,
      succeeded: 2,
      failed: 0,
      results: [
        { id: 'tx-001', ok: true, status: 'successful' },
        { id: 'tx-002', ok: true, status: 'provider_pending' },
      ],
    });

    const response = await requeryPendingWorker(new Request('http://localhost/api/admin/utility/workers/requery-pending?limit=2', {
      method: 'POST',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.processed).toBe(2);
    expect(requeryPendingUtilityTransactions).toHaveBeenCalledWith(2);
    expect(addAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'utility.worker.requery_pending',
    }));
  });

  it('rotates provider credentials without returning raw secrets', async () => {
    vi.mocked(adminUpdateUtilityRow).mockResolvedValue({
      id: 'provider-001',
      name: 'Provider A',
      credentials_configured: true,
    });

    const response = await rotateProviderCredentials(makeRequest('/api/admin/utility/providers/provider-001/credentials', {
      method: 'PUT',
      body: { credentials: { apiKey: 'raw-secret' } },
    }), { params: { id: 'provider-001' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.provider.credentials).toBeUndefined();
    expect(body.provider.credentials_configured).toBe(true);
    expect(adminUpdateUtilityRow).toHaveBeenCalledWith('utility_providers', 'provider-001', {
      credentials: { apiKey: 'raw-secret' },
    });
    expect(addAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'utility.provider.credentials.rotate',
      newValue: { credentials_configured: true },
    }));
  });
});
