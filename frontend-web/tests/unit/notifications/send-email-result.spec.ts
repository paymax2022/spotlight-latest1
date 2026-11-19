import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * sendEmail's return value is the only thing that tells a caller whether a
 * message actually left the building.
 *
 * Every dev machine and CI runner has no RESEND_API_KEY, and in that state the
 * function logs and skips. If it also resolved `true`, the Open Mic console
 * would tell an admin "the applicant was emailed" about a message nobody
 * received — and an operator who gets caught out once stops believing the
 * label. So: false when nothing was sent, true when the provider accepted the
 * message, rejection when the provider refused or could not be reached
 * (AUD-REL-001, unchanged).
 */
import { sendEmail } from '@/src/server/notifications/email';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sendEmail delivery result', () => {
  it('reports false and posts nothing when no provider is configured', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(sendEmail('a@b.co', 'Subject', '<p>Body</p>')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it('logs the recipient and subject but never the body — it can carry amounts and references', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubGlobal('fetch', vi.fn());
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendEmail('a@b.co', 'Your ₦50,000 refund', '<p>Reference PMX_123_ABC</p>');

    const line = String(log.mock.calls[0]?.[0] ?? '');
    expect(line).toContain('a@b.co');
    expect(line).not.toContain('PMX_123_ABC');
  });

  it('reports true when the provider accepts the message', async () => {
    vi.stubEnv('RESEND_API_KEY', 'rk_test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":"em_1"}', { status: 200 })));

    await expect(sendEmail('a@b.co', 'Subject', '<p>Body</p>')).resolves.toBe(true);
  });

  it('still rejects on a provider refusal rather than reporting a false success', async () => {
    vi.stubEnv('RESEND_API_KEY', 'rk_test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"name":"validation_error"}', { status: 422 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendEmail('a@b.co', 'Subject', '<p>Body</p>')).rejects.toThrow('resend failed: 422');
  });
});
