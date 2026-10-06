/**
 * Crowdfunding uploads — prod-sweep fixes.
 *
 * Covers POST /api/crowdfunding/uploads (campaign cover) and
 * POST /api/crowdfunding/uploads/documents (supporting docs):
 *
 *  1. A non-multipart POST used to let request.formData() throw out of the
 *     handler and surface as a 500. It now maps to 415, mirroring the
 *     registration-uploads fix from PR #490 (4880430a).
 *
 *  2. The returned absolute URL used to be built from
 *     `new URL(request.url).origin`, which yields `http://0.0.0.0:PORT` on
 *     Railway (the server binds the wildcard address) — an unusable URL the
 *     submit payload then persisted as the campaign cover. The origin now
 *     comes from NEXT_PUBLIC_SITE_URL, the convention used by every sibling
 *     route (contestants share, vote-page, forgot-password). Host /
 *     X-Forwarded-Host are deliberately NOT consulted: nothing in the
 *     codebase validates them against an allow-list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/src/lib/auth/server', () => ({ requireUser: vi.fn() }));
vi.mock('@/src/lib/storage/r2', () => ({
  createR2UploadUrl: vi.fn(),
  hasR2Config: vi.fn().mockReturnValue(false),
}));
vi.mock('@/src/lib/storage/local-uploads', () => ({
  saveLocalUpload: vi.fn().mockResolvedValue(undefined),
}));

import { POST as coverPOST } from '../../../app/api/crowdfunding/uploads/route';
import { POST as documentsPOST } from '../../../app/api/crowdfunding/uploads/documents/route';
import { requireUser } from '@/src/lib/auth/server';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// Simulate the Railway shape that produced the bug: the server binds
// 0.0.0.0:8080, so request.url's origin is the bind address, not the site.
const RAILWAY_REQUEST_ORIGIN = 'http://0.0.0.0:8080';

function multipartRequest(path: string, fileName = 'cover.png', mimeType = 'image/png') {
  const form = new FormData();
  form.set('file', new File([PNG], fileName, { type: mimeType }));
  return new Request(`${RAILWAY_REQUEST_ORIGIN}${path}`, { method: 'POST', body: form });
}

function jsonRequest(path: string) {
  return new Request(`${RAILWAY_REQUEST_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file: 'not-multipart' }),
  });
}

const SITE_URL_ENV = 'NEXT_PUBLIC_SITE_URL';
let savedSiteUrl: string | undefined;

describe('crowdfunding uploads: 415 on non-multipart + absolute URL from NEXT_PUBLIC_SITE_URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue({ user: { id: 'user-1' } } as any);
    savedSiteUrl = process.env[SITE_URL_ENV];
  });

  afterEach(() => {
    if (savedSiteUrl === undefined) {
      delete process.env[SITE_URL_ENV];
    } else {
      process.env[SITE_URL_ENV] = savedSiteUrl;
    }
  });

  it.each([
    ['cover', coverPOST, '/api/crowdfunding/uploads'],
    ['documents', documentsPOST, '/api/crowdfunding/uploads/documents'],
  ])('%s: a non-multipart POST returns 415, not 500', async (_label, handler, path) => {
    const res = await handler(jsonRequest(path));
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toMatch(/multipart/i);
  });

  it('cover: returned url uses NEXT_PUBLIC_SITE_URL, never the request bind origin', async () => {
    process.env[SITE_URL_ENV] = 'https://app.example.com';
    const res = await coverPOST(multipartRequest('/api/crowdfunding/uploads'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upload.url).toMatch(
      /^https:\/\/app\.example\.com\/api\/crowdfunding\/uploads\//,
    );
    expect(body.upload.url).not.toContain('0.0.0.0');
  });

  it('documents: returned url uses NEXT_PUBLIC_SITE_URL and the documents reader path', async () => {
    process.env[SITE_URL_ENV] = 'https://app.example.com';
    const res = await documentsPOST(
      multipartRequest('/api/crowdfunding/uploads/documents', 'invoice.pdf', 'application/pdf'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upload.url).toMatch(
      /^https:\/\/app\.example\.com\/api\/crowdfunding\/uploads\/documents\//,
    );
    expect(body.upload.url).not.toContain('0.0.0.0');
  });

  it('falls back to the canonical site default when NEXT_PUBLIC_SITE_URL is unset', async () => {
    delete process.env[SITE_URL_ENV];
    const res = await coverPOST(multipartRequest('/api/crowdfunding/uploads'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upload.url).toMatch(
      /^https:\/\/www\.spotlightng\.com\/api\/crowdfunding\/uploads\//,
    );
  });

  it('still 401s unauthenticated requests before parsing the body', async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error('UNAUTHORIZED'));
    const res = await coverPOST(jsonRequest('/api/crowdfunding/uploads'));
    expect(res.status).toBe(401);
  });
});
