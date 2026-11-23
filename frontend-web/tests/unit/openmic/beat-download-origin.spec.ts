import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * Where a beat download is allowed to land.
 *
 * The contestant's Download button opens this GET route, and the row stores a
 * ROOT-RELATIVE reader path (`/api/open-mic/beats/<key>?download=1`) on purpose —
 * the same reason contest banners are root-relative: an absolute URL bakes the
 * uploading environment's host into the row.
 *
 * So the redirect has to supply an origin, and the origin it supplies has to be
 * the one the deployment is actually serving. Hardcoding the public domain made a
 * localhost (or preview-deployment) applicant leave their own site mid-download,
 * land on production, and be told the beat does not exist — a 404 for a file the
 * admin had just uploaded, with nothing in the message pointing at the wrong host.
 *
 * The rules this pins, in order:
 *   • an explicit `NEXT_PUBLIC_SITE_URL` always wins (it is what production sets);
 *   • with no such variable, a dev server redirects within itself;
 *   • an absolute configured URL is the admin's own choice and passes through.
 */
const KEY = 'b3Blbm1pYy1iZWF0cy9jN2FiODQ3OS9lZDI5ODc1YS5tcDM';
const READER = `/api/open-mic/beats/${KEY}?download=1`;
const CONTEST = {
  id: 'c7ab8479-0275-473d-a78f-b923664a3b54',
  slug: 'open-mic-dev',
  beat: {
    id: '9d140ff1-d69b-4d74-a852-960f34cce9d8',
    beatTitle: 'Street Light (dev beat)',
    previewUrl: READER.replace('?download=1', ''),
    downloadUrl: READER,
    usageRules: 'Original bars only.',
  },
};

vi.mock('@/src/server/openmic/persistence', () => ({
  getContestBySlug: async () => CONTEST,
  logBeatDownload: async () => undefined,
}));
vi.mock('@/src/lib/auth/request', () => ({
  requireRequestUser: async () => ({ id: 'artist-1' }),
}));

const originalNodeEnv = process.env.NODE_ENV;
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

/**
 * Next's generated types freeze `process.env.NODE_ENV`, and `SITE_URL` is resolved
 * at import time — so the cases write through a plain record and reload the module
 * graph instead of assigning the augmented property.
 */
function setEnv(name: 'NODE_ENV' | 'NEXT_PUBLIC_SITE_URL', value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[name];
  else env[name] = value;
}

/** site-url reads its inputs at import time, so each case needs a fresh module graph. */
async function loadRoute() {
  vi.resetModules();
  const mod = await import('@/app/api/open-mic/contests/[slug]/beat/download/route');
  return mod.GET;
}

function download(GET: typeof import('@/app/api/open-mic/contests/[slug]/beat/download/route').GET) {
  return GET(new Request('http://localhost:3000/api/open-mic/contests/open-mic-dev/beat/download'), {
    params: Promise.resolve({ slug: 'open-mic-dev' }),
  });
}

afterAll(() => {
  setEnv('NODE_ENV', originalNodeEnv);
  setEnv('NEXT_PUBLIC_SITE_URL', originalSiteUrl);
});

describe('GET /api/open-mic/contests/[slug]/beat/download origin', () => {
  it('keeps a development download on the origin that served it', async () => {
    setEnv('NEXT_PUBLIC_SITE_URL', undefined);
    setEnv('NODE_ENV', 'development');
    const GET = await loadRoute();
    const res = await download(GET);
    const location = res.headers.get('location') || '';
    expect(res.status).toBe(302);
    expect(location).toContain(READER);
    expect(location).toMatch(/^http:\/\/localhost:3000\/api\/open-mic\/beats\//);
    expect(location).not.toContain('spotlightng.com');
  });

  it('honours an explicitly configured site origin', async () => {
    setEnv('NEXT_PUBLIC_SITE_URL', 'https://staging.spotlightng.com');
    setEnv('NODE_ENV', 'development');
    const GET = await loadRoute();
    const res = await download(GET);
    expect(res.headers.get('location')).toBe(`https://staging.spotlightng.com${READER}`);
  });

  it('passes an absolute configured URL through untouched', async () => {
    setEnv('NEXT_PUBLIC_SITE_URL', undefined);
    setEnv('NODE_ENV', 'development');
    CONTEST.beat.downloadUrl = 'https://cdn.example.com/street-light.mp3';
    try {
      const GET = await loadRoute();
      const res = await download(GET);
      expect(res.headers.get('location')).toBe('https://cdn.example.com/street-light.mp3');
    } finally {
      CONTEST.beat.downloadUrl = READER;
    }
  });
});
