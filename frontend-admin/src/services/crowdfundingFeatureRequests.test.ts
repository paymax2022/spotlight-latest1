// @vitest-environment node
/**
 * The feature-request contract is PROVISIONAL — the backend's storage for owner
 * feature requests is being designed in parallel with this console, and the field
 * names / id scheme may land differently.
 *
 * Every assumption about the wire shape lives in ONE mapping function in the
 * service. These tests pin those assumptions executably, so reconciling with the
 * shipped backend is a diff against a list of asserted field names rather than an
 * archaeology exercise across the UI.
 *
 * The two behaviours that MUST survive any reconciliation:
 *   1. An unrecognisable campaign status maps to UNKNOWN, which gates approval.
 *      Guessing ACTIVE would turn a payload change into a stream of 409s.
 *   2. A refusal is surfaced with the server's own message and never rendered as
 *      a success.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('crowdfunding feature requests — assumed wire shape', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    // Live branch: this suite is about the wire mapping, not the fixtures.
    vi.stubEnv('NEXT_PUBLIC_CF_USE_MOCK', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function mockFetch(body: unknown, init?: { ok?: boolean; status?: number }) {
    const fn = vi.fn(async () => ({
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      json: async () => body,
    }));
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('reads the documented camelCase payload from /feature-requests', async () => {
    const fetchFn = mockFetch({
      requests: [{
        id: 'fr_1', campaignId: 'cmp_1', campaignTitle: 'Borehole for Amaeze',
        status: 'PENDING', campaignStatus: 'ACTIVE',
        raisedKobo: 168_300_000, goalKobo: 240_000_000, contributorCount: 311,
        requestedBy: 'Chinedu Okafor', requestedAt: '2026-06-20T08:15:00Z',
      }],
    });
    const mod = await import('@/services/crowdfundingAdminService');
    const out = await mod.listFeatureRequests();

    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toContain('/api/crowdfunding/admin/feature-requests');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'fr_1', campaignId: 'cmp_1', campaignTitle: 'Borehole for Amaeze',
      status: 'PENDING', campaignStatus: 'ACTIVE',
      raisedKobo: 168_300_000, goalKobo: 240_000_000, contributorCount: 311,
      requestedBy: 'Chinedu Okafor',
    });
  });

  it('tolerates a snake_case payload — the Go module emits both conventions', async () => {
    mockFetch({
      requests: [{
        request_id: 'fr_2', campaign_id: 'cmp_2', campaign_title: 'Tailoring shop',
        status: 'pending', campaign_status: 'frozen',
        raised_kobo: 41_200_000, goal_kobo: 90_000_000, contributor_count: 74,
        requested_by: 'Ngozi Eze', requested_at: '2026-06-21T14:02:00Z',
      }],
    });
    const mod = await import('@/services/crowdfundingAdminService');
    const [r] = await mod.listFeatureRequests();

    expect(r.id).toBe('fr_2');
    expect(r.campaignId).toBe('cmp_2');
    expect(r.campaignStatus).toBe('FROZEN');
    expect(r.raisedKobo).toBe(41_200_000);
    expect(r.contributorCount).toBe(74);
  });

  it('money arrives as integer kobo even when the backend quotes it as a string', async () => {
    mockFetch({ requests: [{ id: 'fr_3', raisedKobo: '250000', goalKobo: '1000000' }] });
    const mod = await import('@/services/crowdfundingAdminService');
    const [r] = await mod.listFeatureRequests();

    expect(r.raisedKobo).toBe(250_000);
    expect(r.goalKobo).toBe(1_000_000);
    expect(Number.isInteger(r.raisedKobo)).toBe(true);
  });

  it('an unrecognisable campaign status fails CLOSED to UNKNOWN, never to ACTIVE', async () => {
    mockFetch({ requests: [{ id: 'fr_4', campaignStatus: 'live' }] });
    const mod = await import('@/services/crowdfundingAdminService');
    const [r] = await mod.listFeatureRequests();

    // 'live' is not a CfCampaignStatus. Mapping it to ACTIVE would let the console
    // offer an approval the backend refuses with 409.
    expect(r.campaignStatus).toBe('UNKNOWN');
  });

  it('a missing campaign status is UNKNOWN, so approval stays gated', async () => {
    mockFetch({ requests: [{ id: 'fr_5', status: 'PENDING' }] });
    const mod = await import('@/services/crowdfundingAdminService');
    const [r] = await mod.listFeatureRequests();
    expect(r.campaignStatus).toBe('UNKNOWN');
  });

  it('accepts a bare array in place of { requests }', async () => {
    mockFetch([{ id: 'fr_6', campaignStatus: 'ACTIVE' }]);
    const mod = await import('@/services/crowdfundingAdminService');
    expect(await mod.listFeatureRequests()).toHaveLength(1);
  });

  it('approve POSTs to /approve with an Idempotency-Key and no body', async () => {
    const fetchFn = mockFetch({ id: 'fr_1', status: 'APPROVED', campaignStatus: 'ACTIVE' });
    const mod = await import('@/services/crowdfundingAdminService');
    const out = await mod.decideFeatureRequest('fr_1', true, '');

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/feature-requests/fr_1/approve');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toContain('fr_1');
    expect(init.body).toBeUndefined();
    expect(out.status).toBe('APPROVED');
  });

  it('reject POSTs the note, and approve/reject get DISTINCT idempotency keys', async () => {
    const fetchFn = mockFetch({ id: 'fr_1', status: 'REJECTED', campaignStatus: 'ACTIVE', note: 'too early' });
    const mod = await import('@/services/crowdfundingAdminService');
    await mod.decideFeatureRequest('fr_1', false, 'too early');
    await mod.decideFeatureRequest('fr_1', true, '');

    const [rejectUrl, rejectInit] = fetchFn.mock.calls[0] as [string, RequestInit];
    const [, approveInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    expect(String(rejectUrl)).toContain('/feature-requests/fr_1/reject');
    expect(JSON.parse(String(rejectInit.body))).toEqual({ note: 'too early' });
    expect((rejectInit.headers as Record<string, string>)['Idempotency-Key'])
      .not.toBe((approveInit.headers as Record<string, string>)['Idempotency-Key']);
  });

  it('a 409 refusal throws the server message rather than resolving as success', async () => {
    mockFetch({ error: 'campaign is not ACTIVE' }, { ok: false, status: 409 });
    const mod = await import('@/services/crowdfundingAdminService');
    await expect(mod.decideFeatureRequest('fr_3', true, '')).rejects.toThrow('campaign is not ACTIVE');
  });

  it('a refusal with no error field still throws, carrying the status code', async () => {
    mockFetch({}, { ok: false, status: 500 });
    const mod = await import('@/services/crowdfundingAdminService');
    await expect(mod.decideFeatureRequest('fr_4', false, 'n')).rejects.toThrow('500');
  });

  it('unwraps a decision returned as { request: … }', async () => {
    mockFetch({ request: { id: 'fr_7', status: 'APPROVED', campaignStatus: 'ACTIVE' } });
    const mod = await import('@/services/crowdfundingAdminService');
    const out = await mod.decideFeatureRequest('fr_7', true, '');
    expect(out.id).toBe('fr_7');
    expect(out.status).toBe('APPROVED');
  });
});
