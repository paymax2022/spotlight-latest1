// The voter-facing photo reader: /api/v1/contestants/[id]/photo.
//
// Go's voting API used to sign contestant photos itself. It cannot know whether
// the upload that produced the stored key landed in R2 or on this app's disk, so
// on a deployment without bucket credentials it handed every voter a signature
// for an object that does not exist, and the profile showed no picture. The API
// now names this route instead, and this route asks the plane that owns the
// files. Pattern follows tests/unit/registration/contest-admin-schedule-route.spec.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createAdminClient = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createAdminClient }));

const serveContestantPhoto = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/storage/contestant-photo', () => ({ serveContestantPhoto }));

import { GET } from '@/app/api/v1/contestants/[id]/photo/route';

const ID = '5af2241f-ddf0-44be-b9f9-39f7a48b15a7';

type Row = { photo_url?: string | null; status?: string } | null;

/** The chain the route builds: from().select().eq().in().maybeSingle(). */
function installRow(row: Row, error: unknown = null): string[] {
  const calls: string[] = [];
  const builder: Record<string, unknown> = {
    from: vi.fn((table: string) => {
      calls.push(`from:${table}`);
      return builder;
    }),
    select: vi.fn((cols: string) => {
      calls.push(`select:${cols}`);
      return builder;
    }),
    eq: vi.fn((col: string, value: string) => {
      calls.push(`eq:${col}=${value}`);
      return builder;
    }),
    in: vi.fn((col: string, values: string[]) => {
      calls.push(`in:${col}=${values.join(',')}`);
      return builder;
    }),
    maybeSingle: vi.fn(async () => ({ data: row, error })),
  };
  createAdminClient.mockReturnValue(builder as never);
  return calls;
}

function get(id = ID) {
  return GET(new Request(`http://localhost:3000/api/v1/contestants/${id}/photo`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  createAdminClient.mockReset();
  serveContestantPhoto.mockReset();
  serveContestantPhoto.mockImplementation(
    async () => new Response(null, { status: 307, headers: { Location: 'https://r2.example/photo?sig=abc' } }),
  );
});

describe('GET /api/v1/contestants/[id]/photo', () => {
  it('answers from the stored row through the photo responder', async () => {
    const stored = JSON.stringify({ storageKey: 'registration/u1/p.jpeg' });
    const calls = installRow({ photo_url: stored, status: 'approved' });

    const res = await get();

    expect(res.status).toBe(307);
    // The key comes from the row and nowhere else — that is what keeps the
    // identity documents sharing registration/<userId>/ out of reach.
    expect(serveContestantPhoto).toHaveBeenCalledTimes(1);
    expect(serveContestantPhoto).toHaveBeenCalledWith(stored);
    expect(calls).toEqual([
      'from:contestants',
      'select:photo_url, status',
      `eq:id=${ID}`,
      'in:status=approved,active',
    ]);
  });

  it('refuses a malformed id before touching the database', async () => {
    installRow(null);

    const res = await get('..%2Fetc%2Fpasswd');

    expect(res.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(serveContestantPhoto).not.toHaveBeenCalled();
  });

  // A contestant who is not on the public roster has no public picture, and the
  // answer is 404 so the route never confirms an application exists.
  it('404s a contestant the roster does not publish', async () => {
    installRow(null);

    const res = await get();

    expect(res.status).toBe(404);
    expect(serveContestantPhoto).not.toHaveBeenCalled();
  });

  it('hands a null column to the responder, which 404s it', async () => {
    installRow({ photo_url: null, status: 'active' });
    serveContestantPhoto.mockImplementation(async () => new Response('{"success":false}', { status: 404 }));

    const res = await get();

    expect(res.status).toBe(404);
    expect(serveContestantPhoto).toHaveBeenCalledWith(null);
  });

  it('reports a query failure through the shared error envelope', async () => {
    installRow(null, new Error('boom'));

    const res = await get();

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await res.json()).toMatchObject({ success: false });
  });
});
