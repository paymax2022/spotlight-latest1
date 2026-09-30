import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendVoteReceiptEmail } from '@/src/server/voting/email.service';

// AUD-REL-001: sendEmail used to resolve normally on Resend 4xx/5xx — the
// failure was invisible to every caller. It must now log + reject.

const receipt = {
  to: 'voter@example.com',
  voterName: 'Voter',
  contestantName: 'Contestant',
  contestName: 'Contest',
  votesPurchased: 5,
  bonusVotes: 0,
  amountPaid: 50000,
  currency: 'NGN',
  receiptNumber: 'R-1',
  paymentRef: 'ref-1',
  issuedAt: '2026-01-01T00:00:00Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('AUD-REL-001 email response checking', () => {
  it('resolves on a Resend 2xx', async () => {
    vi.stubEnv('RESEND_API_KEY', 'rk_test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await expect(sendVoteReceiptEmail(receipt)).resolves.toBeUndefined();
  });

  it('rejects and logs on a Resend non-2xx', async () => {
    vi.stubEnv('RESEND_API_KEY', 'rk_test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"name":"validation_error"}', { status: 422 })));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(sendVoteReceiptEmail(receipt)).rejects.toThrow('resend failed: 422');
    expect(spy).toHaveBeenCalled();
  });

  it('rejects and logs on a network failure', async () => {
    vi.stubEnv('RESEND_API_KEY', 'rk_test');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(sendVoteReceiptEmail(receipt)).rejects.toThrow('ECONNREFUSED');
    expect(spy).toHaveBeenCalled();
  });

  it('dev path: no API key logs and resolves without fetch', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendVoteReceiptEmail(receipt)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
