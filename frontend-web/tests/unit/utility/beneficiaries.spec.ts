import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest, withAuth } from '../golden-path/_fixtures';

vi.mock('@/src/lib/feature-flags', () => ({
  featureFlags: {
    utilityPayments: vi.fn(() => true),
    utilityBillsGoProxy: vi.fn(() => false),
  },
}));

vi.mock('@/src/lib/go-backend', () => ({
  GO_BACKEND_URL: 'http://localhost:8080',
  proxyToGoBackend: vi.fn(),
}));

vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: vi.fn(),
}));

vi.mock('@/src/lib/voting/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, remaining: 9, resetInMs: 60_000 })),
}));

vi.mock('@/src/server/utility/service', () => ({
  listUtilityBeneficiaries: vi.fn(),
  saveUtilityBeneficiary: vi.fn(),
  deleteUtilityBeneficiary: vi.fn(),
}));

import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import {
  deleteUtilityBeneficiary,
  listUtilityBeneficiaries,
  saveUtilityBeneficiary,
} from '@/src/server/utility/service';
import { GET as listBeneficiaries, POST as saveBeneficiary } from '../../../app/api/v1/utility/beneficiaries/route';
import { DELETE as deleteBeneficiary } from '../../../app/api/v1/utility/beneficiaries/[id]/route';

const TEST_USER = { id: 'user-utility-001', email: 'utility@example.com' };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('utility beneficiaries routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(featureFlags.utilityPayments).mockReturnValue(true);
    vi.mocked(featureFlags.utilityBillsGoProxy).mockReturnValue(false);
    vi.mocked(requireRequestUser).mockResolvedValue(TEST_USER);
  });

  it('serves beneficiaries from the local service when the Go-proxy flag is off', async () => {
    vi.mocked(listUtilityBeneficiaries).mockResolvedValue([{ id: 'ben-001', label: 'Mum' }] as never);

    const response = await listBeneficiaries(new Request('http://localhost/api/v1/utility/beneficiaries', {
      headers: withAuth(),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.beneficiaries).toHaveLength(1);
    expect(listUtilityBeneficiaries).toHaveBeenCalledWith(TEST_USER.id, undefined);
    expect(proxyToGoBackend).not.toHaveBeenCalled();
  });

  it('proxies beneficiary list to the Go engine when the flag is on', async () => {
    vi.mocked(featureFlags.utilityBillsGoProxy).mockReturnValue(true);
    vi.mocked(proxyToGoBackend).mockResolvedValue(jsonResponse({ beneficiaries: [{ id: 'ben-002' }] }));

    const response = await listBeneficiaries(new Request('http://localhost/api/v1/utility/beneficiaries', {
      headers: withAuth(),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.beneficiaries).toHaveLength(1);
    expect(proxyToGoBackend).toHaveBeenCalledWith(expect.anything(), '/api/finance/utilitybills/beneficiaries');
    expect(listUtilityBeneficiaries).not.toHaveBeenCalled();
  });

  it('saves a beneficiary locally when the flag is off, accepting snake_case fields', async () => {
    vi.mocked(saveUtilityBeneficiary).mockResolvedValue({ id: 'ben-003', label: 'DSTV' } as never);

    const response = await saveBeneficiary(makeRequest('/api/v1/utility/beneficiaries', {
      body: {
        category: 'CABLE_TV',
        biller_id: 'biller-001',
        label: 'DSTV',
        customer_reference: '1234567890',
      },
      headers: withAuth(),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.beneficiary.label).toBe('DSTV');
    expect(saveUtilityBeneficiary).toHaveBeenCalledWith(TEST_USER.id, expect.objectContaining({
      category: 'cable_tv',
      billerId: 'biller-001',
      customerReference: '1234567890',
    }));
    expect(proxyToGoBackend).not.toHaveBeenCalled();
  });

  it('rejects a beneficiary save with no recognisable category', async () => {
    const response = await saveBeneficiary(makeRequest('/api/v1/utility/beneficiaries', {
      body: { biller_id: 'biller-001', label: 'DSTV' },
      headers: withAuth(),
    }));

    expect(response.status).toBe(400);
    expect(saveUtilityBeneficiary).not.toHaveBeenCalled();
  });

  it('proxies beneficiary save to the Go engine when the flag is on, mapping to 201', async () => {
    vi.mocked(featureFlags.utilityBillsGoProxy).mockReturnValue(true);
    vi.mocked(proxyToGoBackend).mockResolvedValue(jsonResponse({ beneficiary: { id: 'ben-004' } }));

    const response = await saveBeneficiary(makeRequest('/api/v1/utility/beneficiaries', {
      body: { category: 'airtime', biller_id: 'biller-001', label: 'MTN', customer_reference: '0803' },
      headers: withAuth(),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.beneficiary.id).toBe('ben-004');
    expect(proxyToGoBackend).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/utilitybills/beneficiaries',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(saveUtilityBeneficiary).not.toHaveBeenCalled();
  });

  it('deletes a beneficiary locally when the flag is off', async () => {
    vi.mocked(deleteUtilityBeneficiary).mockResolvedValue(undefined);

    const response = await deleteBeneficiary(new Request('http://localhost/api/v1/utility/beneficiaries/ben-001', {
      method: 'DELETE',
      headers: withAuth(),
    }), { params: Promise.resolve({ id: 'ben-001' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(deleteUtilityBeneficiary).toHaveBeenCalledWith(TEST_USER.id, 'ben-001');
    expect(proxyToGoBackend).not.toHaveBeenCalled();
  });

  it('proxies beneficiary delete to the Go engine when the flag is on', async () => {
    vi.mocked(featureFlags.utilityBillsGoProxy).mockReturnValue(true);
    vi.mocked(proxyToGoBackend).mockResolvedValue(jsonResponse({}, 200));

    const response = await deleteBeneficiary(new Request('http://localhost/api/v1/utility/beneficiaries/ben-001', {
      method: 'DELETE',
      headers: withAuth(),
    }), { params: Promise.resolve({ id: 'ben-001' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(proxyToGoBackend).toHaveBeenCalledWith(
      expect.anything(),
      '/api/finance/utilitybills/beneficiaries/ben-001',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(deleteUtilityBeneficiary).not.toHaveBeenCalled();
  });
});
