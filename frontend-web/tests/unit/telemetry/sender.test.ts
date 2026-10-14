import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSender } from '@/src/features/telemetry/senderCore';

const ev = { surface: 'web' as const, route: '/wallet', occurred_at: '2026-01-01T00:00:00Z' };
const base = 'http://localhost:8080/api/v1';

describe('createSender', () => {
  it('posts body, bearer header and path', async () => {
    const post = vi.fn().mockResolvedValue({ status: 202 });
    await createSender({ getToken: async () => 'tok', baseURL: base, post })([ev]);
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, init] = post.mock.calls[0];
    expect(url.endsWith('/api/v1/telemetry/navigation')).toBe(true);
    expect(body).toEqual({ events: [ev] });
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.keepalive).toBe(true);
  });
  it('no token -> no request', async () => {
    const post = vi.fn();
    await createSender({ getToken: async () => null, baseURL: base, post })([ev]);
    expect(post).not.toHaveBeenCalled();
  });
  it('empty batch -> no request', async () => {
    const post = vi.fn();
    await createSender({ getToken: async () => 't', baseURL: base, post })([]);
    expect(post).not.toHaveBeenCalled();
  });
  it('swallows token errors, network errors and 401', async () => {
    await expect(createSender({ getToken: async () => { throw new Error('x'); }, baseURL: base, post: vi.fn() })([ev])).resolves.toBeUndefined();
    await expect(createSender({ getToken: async () => 't', baseURL: base, post: async () => { throw new Error('net'); } })([ev])).resolves.toBeUndefined();
    await expect(createSender({ getToken: async () => 't', baseURL: base, post: async () => ({ status: 401 }) })([ev])).resolves.toBeUndefined();
  });
  it('strips extra fields from events', async () => {
    const post = vi.fn().mockResolvedValue({});
    await createSender({ getToken: async () => 't', baseURL: base, post })([{ ...ev, user_id: 'u' } as never]);
    expect(post.mock.calls[0][1]).toEqual({ events: [ev] });
  });
});

describe('sender wiring', () => {
  const src = readFileSync(join(__dirname, '../../../src/features/telemetry/sender.ts'), 'utf8');
  it('does not import any shared authed client', () => {
    const imports = src.split('\n').filter((l) => /^\s*import /.test(l)).join('\n');
    expect(imports).not.toMatch(/go-backend|apiClient|axios|authed|fetchWithAuth/i);
    expect(imports).toMatch(/supabase\/client/);
  });
});
