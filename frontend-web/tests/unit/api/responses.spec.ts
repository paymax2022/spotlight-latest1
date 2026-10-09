import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

import * as Sentry from '@sentry/nextjs';
import { ApiError, handleApiError } from '@/src/lib/api/responses';

const captureException = vi.mocked(Sentry.captureException);

describe('handleApiError', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('maps ApiError to its status without reporting', async () => {
    const res = handleApiError(new ApiError('bad input', 400));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ success: false, error: 'bad input' });
    expect(captureException).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('maps UNAUTHORIZED to 401 without reporting', () => {
    const res = handleApiError(new Error('UNAUTHORIZED'));

    expect(res.status).toBe(401);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('maps FORBIDDEN to 403 without reporting', () => {
    const res = handleApiError(new Error('FORBIDDEN'));

    expect(res.status).toBe(403);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('reports unexpected errors to console and Sentry before returning a generic 500', async () => {
    const err = new Error('postgrest connection reset');

    const res = handleApiError(err);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ success: false, error: 'Internal server error' });
    expect(consoleError).toHaveBeenCalledWith('[api] Unhandled route error:', err);
    expect(captureException).toHaveBeenCalledWith(err);
  });

  it('uses the caller-provided fallback message and still reports', async () => {
    const err = new Error('r2 timeout');

    const res = handleApiError(err, 'Upload failed');

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ success: false, error: 'Upload failed' });
    expect(captureException).toHaveBeenCalledWith(err);
  });

  it('reports non-Error thrown values', async () => {
    const res = handleApiError('string failure');

    expect(res.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith('[api] Unhandled route error:', 'string failure');
    expect(captureException).toHaveBeenCalledWith('string failure');
  });

  it('still returns a 500 when Sentry capture throws', async () => {
    captureException.mockImplementationOnce(() => {
      throw new Error('sentry transport down');
    });

    const res = handleApiError(new Error('upstream exploded'));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ success: false, error: 'Internal server error' });
  });
});
