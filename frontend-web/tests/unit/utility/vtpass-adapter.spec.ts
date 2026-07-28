import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vtpassRequestId, vtpassUtilityAdapter } from '@/src/server/utility/adapters/vtpass';

const OLD_ENV = {
  VTPASS_ENVIRONMENT: process.env.VTPASS_ENVIRONMENT,
  VTPASS_BASE_URL: process.env.VTPASS_BASE_URL,
  VTPASS_API_KEY: process.env.VTPASS_API_KEY,
  VTPASS_PUBLIC_KEY: process.env.VTPASS_PUBLIC_KEY,
  VTPASS_SECRET_KEY: process.env.VTPASS_SECRET_KEY,
};

const pricing = {
  amountKobo: 100_000,
  convenienceFeeKobo: 0,
  retailAmountKobo: 100_000,
  providerCostKobo: 96_000,
  grossProfitKobo: 4_000,
  grossMarginBps: 400,
};

// NOTE: the adapter now has a local sandbox simulator — when
// VTPASS_ENVIRONMENT=sandbox, validateCustomer/purchase/queryTransactionStatus
// short-circuit (no fetch). The HTTP-contract tests below therefore run in
// 'live' mode against a fake base URL; sandbox behaviour has its own tests.
function setVtpassEnv() {
  process.env.VTPASS_ENVIRONMENT = 'live';
  process.env.VTPASS_BASE_URL = 'https://sandbox.vtpass.test/api';
  process.env.VTPASS_API_KEY = 'test-api-key';
  process.env.VTPASS_PUBLIC_KEY = 'test-public-key';
  process.env.VTPASS_SECRET_KEY = 'test-secret-key';
}

function restoreEnv() {
  for (const [key, value] of Object.entries(OLD_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('VTPass utility adapter', () => {
  beforeEach(() => {
    setVtpassEnv();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it('generates request IDs with the required Lagos timestamp prefix', () => {
    const requestId = vtpassRequestId('UTILITY-user-data-abc123', new Date('2026-06-13T11:45:00.000Z'));

    expect(requestId.startsWith('202606131245')).toBe(true);
    expect(requestId.length).toBeGreaterThanOrEqual(12);
  });

  it('posts airtime purchases with VTPass headers and payload shape', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      code: '000',
      response_description: 'TRANSACTION SUCCESSFUL',
      requestId: '202606131245abc123',
      content: { transactions: { status: 'delivered', transactionId: 'vtpass-tx-001' } },
      purchased_code: '',
    })));

    const result = await vtpassUtilityAdapter.purchase({
      transactionId: 'tx-001',
      idempotencyKey: 'UTILITY-user-airtime-abc123',
      category: 'airtime',
      billerCode: 'mtn',
      providerBillerCode: 'mtn',
      productCode: 'mtn-airtime',
      providerProductCode: 'mtn',
      customerReference: '08011111111',
      pricing,
    });

    expect(fetch).toHaveBeenCalledWith('https://sandbox.vtpass.test/api/pay', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'api-key': 'test-api-key',
        'secret-key': 'test-secret-key',
      }),
      body: expect.stringContaining('"serviceID":"mtn"'),
    }));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual(expect.objectContaining({
      serviceID: 'mtn',
      amount: 1000,
      phone: '08011111111',
    }));
    expect(result.status).toBe('successful');
    expect(result.providerReference).toBe('202606131245abc123');
  });

  it('posts product purchases with billersCode and variation_code', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      code: '000',
      response_description: 'TRANSACTION SUCCESSFUL',
      requestId: '202606131245data',
      content: { transactions: { status: 'delivered' } },
    })));

    await vtpassUtilityAdapter.purchase({
      transactionId: 'tx-002',
      idempotencyKey: 'UTILITY-user-data-abc123',
      category: 'data',
      billerCode: 'mtn',
      providerBillerCode: 'mtn-data',
      productCode: 'mtn-1gb',
      providerProductCode: 'mtn-100mb-1000',
      customerReference: '08011111111',
      pricing,
    });

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual(expect.objectContaining({
      serviceID: 'mtn-data',
      billersCode: '08011111111',
      variation_code: 'mtn-100mb-1000',
      amount: 1000,
      phone: '08011111111',
    }));
  });

  it('posts education purchases without billersCode', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      code: '000',
      response_description: 'TRANSACTION SUCCESSFUL',
      requestId: '202606131245waec',
      content: { transactions: { status: 'delivered' } },
      purchased_code: 'PIN: 123456789012',
    })));

    const result = await vtpassUtilityAdapter.purchase({
      transactionId: 'tx-education-001',
      idempotencyKey: 'UTILITY-user-waec-abc123',
      category: 'education',
      billerCode: 'waec',
      providerBillerCode: 'waec',
      productCode: 'waec-result-checker-pin',
      providerProductCode: 'waecdirect',
      customerReference: '08011111111',
      pricing: { ...pricing, amountKobo: 90_000, retailAmountKobo: 90_000, providerCostKobo: 80_000, grossProfitKobo: 10_000 },
      metadata: { quantity: 1 },
    });

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body).toEqual(expect.objectContaining({
      serviceID: 'waec',
      variation_code: 'waecdirect',
      amount: 900,
      quantity: 1,
      phone: '08011111111',
    }));
    expect(body).not.toHaveProperty('billersCode');
    expect(result.status).toBe('successful');
    expect(result.token).toBe('PIN: 123456789012');
  });

  it('verifies electricity customers through merchant-verify', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      code: '000',
      content: {
        Customer_Name: 'TESTMETER1',
        Meter_Number: '1111111111111',
        Meter_Type: 'PREPAID',
      },
    })));

    const result = await vtpassUtilityAdapter.validateCustomer({
      category: 'electricity',
      billerCode: 'ikeja-electric',
      providerBillerCode: 'ikeja-electric',
      customerReference: '1111111111111',
      metadata: { paymentType: 'prepaid' },
    });

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual(expect.objectContaining({
      billersCode: '1111111111111',
      serviceID: 'ikeja-electric',
      type: 'prepaid',
    }));
    expect(result.valid).toBe(true);
    expect(result.customerName).toBe('TESTMETER1');
  });

  it('posts electricity purchases with prepaid or postpaid variation type', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      code: '000',
      response_description: 'TRANSACTION SUCCESSFUL',
      requestId: '202606131245ikeja',
      content: { transactions: { status: 'delivered' } },
      purchased_code: 'Token: 1234-5678',
    })));

    const result = await vtpassUtilityAdapter.purchase({
      transactionId: 'tx-electricity-001',
      idempotencyKey: 'UTILITY-user-ikeja-abc123',
      category: 'electricity',
      billerCode: 'ikeja-electric',
      providerBillerCode: 'ikeja-electric',
      productCode: 'ikeja-prepaid',
      providerProductCode: 'ikeja-electric',
      customerReference: '1111111111111',
      pricing: { ...pricing, amountKobo: 500_000, retailAmountKobo: 500_000, providerCostKobo: 490_000, grossProfitKobo: 10_000 },
      metadata: { paymentType: 'prepaid', phone: '08022222222' },
    });

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual(expect.objectContaining({
      serviceID: 'ikeja-electric',
      billersCode: '1111111111111',
      variation_code: 'prepaid',
      amount: 5000,
      phone: '08022222222',
    }));
    expect(result.token).toBe('Token: 1234-5678');
  });

  it('requires the VTPass secret key for POST requests', async () => {
    delete process.env.VTPASS_SECRET_KEY;

    await expect(vtpassUtilityAdapter.queryTransactionStatus({
      transactionId: 'tx-001',
      providerReference: '202606131245abc123',
      idempotencyKey: 'UTILITY-key',
    })).rejects.toThrow(/VTPASS_SECRET_KEY/);
  });

  it('simulates purchases locally in sandbox mode without calling VTPass', async () => {
    process.env.VTPASS_ENVIRONMENT = 'sandbox';

    const result = await vtpassUtilityAdapter.purchase({
      transactionId: 'tx-sandbox-001',
      idempotencyKey: 'UTILITY-user-sandbox-abc123',
      category: 'electricity',
      billerCode: 'eko-electric',
      providerBillerCode: 'eko-electric',
      productCode: 'eko-prepaid',
      providerProductCode: 'eko-electric',
      customerReference: '1111111111111', // documented sandbox prepaid meter
      pricing,
      metadata: { paymentType: 'prepaid' },
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.status).toBe('successful');
    expect(result.token).toBeTruthy();
    expect(result.raw).toEqual(expect.objectContaining({ sandbox: true }));
  });

  it('validates only the documented sandbox meters in sandbox mode', async () => {
    process.env.VTPASS_ENVIRONMENT = 'sandbox';

    const valid = await vtpassUtilityAdapter.validateCustomer({
      category: 'electricity',
      billerCode: 'eko-electric',
      providerBillerCode: 'eko-electric',
      customerReference: '1010101010101', // documented sandbox postpaid meter
      metadata: { paymentType: 'postpaid' },
    });
    const invalid = await vtpassUtilityAdapter.validateCustomer({
      category: 'electricity',
      billerCode: 'eko-electric',
      providerBillerCode: 'eko-electric',
      customerReference: '9999999999999',
      metadata: { paymentType: 'prepaid' },
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(valid.valid).toBe(true);
    expect(invalid.valid).toBe(false);
  });

  it('uses public-key for balance health checks', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      code: 1,
      contents: { balance: 1081.82 },
    })));

    const result = await vtpassUtilityAdapter.healthCheck();

    expect(fetch).toHaveBeenCalledWith('https://sandbox.vtpass.test/api/balance', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({
        'api-key': 'test-api-key',
        'public-key': 'test-public-key',
      }),
    }));
    expect(result.status).toBe('healthy');
  });
});
