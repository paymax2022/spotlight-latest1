import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { forwardGoOwnedPaystackEvent } from '../../../app/api/webhooks/paystack/go-forward';

// AUD-INFRA-010: the Next.js receiver (designated live) forwards ONLY
// Go-exclusive charge.success references to the Go receiver. Ambiguous events
// (transfer.*, DVA, wallet top-ups) are claimed by both planes under different
// idempotency keys — forwarding them would double-fulfil, so they must NOT go.

const SIG = 'sha512=valid-signature';

function payload(event: string, reference?: string) {
  return JSON.stringify({
    event,
    data: reference ? { reference } : {},
  });
}

describe('forwardGoOwnedPaystackEvent', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not fetch for non-charge.success events (transfer.* stays local)', async () => {
    const res = await forwardGoOwnedPaystackEvent(payload('transfer.success', 'TRF_1'), SIG);
    expect(res).toEqual({ processed: false, duplicate: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fetch for charge.success with a non-Go reference', async () => {
    const res = await forwardGoOwnedPaystackEvent(payload('charge.success', 'PAY_ref_abc'), SIG);
    expect(res).toEqual({ processed: false, duplicate: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['feespay:', 'foodorder:', 'rideorder:', 'duespay:'])(
    'forwards charge.success with the %s reference prefix verbatim', async (prefix) => {
      const raw = payload('charge.success', `${prefix}abc123`);
      const res = await forwardGoOwnedPaystackEvent(raw, SIG);

      expect(res).toEqual({ processed: true, duplicate: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/api\/webhooks\/paystack\/go$/);
      expect(init.method).toBe('POST');
      expect(init.body).toBe(raw);
      expect(init.headers['x-paystack-signature']).toBe(SIG);
    },
  );

  it('throws on a non-2xx Go response so the dispatcher retries', async () => {
    fetchMock.mockResolvedValue(new Response('upstream down', { status: 502 }));
    await expect(
      forwardGoOwnedPaystackEvent(payload('charge.success', 'feespay:x'), SIG),
    ).rejects.toThrow('go webhook forward failed: 502');
  });

  it('throws when the Go receiver returns 200 with ok:false', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'dispatch failed' }), { status: 200 }),
    );
    await expect(
      forwardGoOwnedPaystackEvent(payload('charge.success', 'rideorder:y'), SIG),
    ).rejects.toThrow('ok:false');
  });

  it('propagates fetch failures (unreachable Go backend) as a retryable rejection', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      forwardGoOwnedPaystackEvent(payload('charge.success', 'duespay:z'), SIG),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('treats an unparseable body as irrelevant rather than failing', async () => {
    const res = await forwardGoOwnedPaystackEvent('not-json', SIG);
    expect(res).toEqual({ processed: false, duplicate: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
