/**
 * AD-003/CS-004 — contest-templates admin API
 * (app/api/admin/voting/contest-templates/**).
 *
 * Mirrors tests/unit/registration/vote-packages-crud.spec.ts's pattern:
 * assertAdminPermission and createAdminClient are mocked at their module
 * boundary, so these assert the routes' own contract (auth gating, image
 * validation, draft-on-create, active-requires-contestant-slot guard,
 * delete-while-active refusal) rather than Postgres itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { GET as listGET, POST as createPOST } from '@/app/api/admin/voting/contest-templates/route';
import {
  GET as itemGET,
  PATCH as itemPATCH,
  DELETE as itemDELETE,
} from '@/app/api/admin/voting/contest-templates/[templateId]/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';

function ctx(templateId = 'tpl-1') {
  return { params: Promise.resolve({ templateId }) };
}

function jsonReq(method: string, body?: unknown, url = 'https://x.test/api/admin/voting/contest-templates') {
  return new Request(url, { method, body: body ? JSON.stringify(body) : undefined });
}

function multipartReq(fields: Record<string, string | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v as any);
  return new Request('https://x.test/api/admin/voting/contest-templates', { method: 'POST', body: fd });
}

/**
 * A single flexible fake Supabase admin client covering everything these
 * routes touch: .from('contest_templates'|'template_slots'|'template_text_overlays')
 * and .storage.from(bucket) for the upload path.
 */
function makeSupabase(opts: {
  templateRow?: any; // returned by .maybeSingle()/.single() for contest_templates
  contestantSlotExists?: boolean; // for the hasContestantSlot() .limit() query
  insertedTemplate?: any;
  updatedTemplate?: any;
  uploadError?: any;
}) {
  const calls: any = { insertPayload: null, updatePayload: null, deletedFrom: [] as string[] };

  function templatesChain() {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: opts.templateRow ?? null, error: null }),
      single: () =>
        Promise.resolve({
          data: opts.insertedTemplate ?? opts.updatedTemplate ?? opts.templateRow ?? null,
          error: null,
        }),
      insert: (payload: any) => {
        calls.insertPayload = payload;
        return chain;
      },
      update: (payload: any) => {
        calls.updatePayload = payload;
        return chain;
      },
      delete: () => {
        calls.deletedFrom.push('contest_templates');
        return chain;
      },
    };
    return chain;
  }

  function slotsChain() {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: opts.contestantSlotExists ? [{ id: 'slot-1' }] : [], error: null }),
    };
    return chain;
  }

  function overlaysChain() {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => Promise.resolve({ data: [], error: null }),
    };
    return chain;
  }

  const client: any = {
    from: (table: string) => {
      if (table === 'contest_templates') return templatesChain();
      if (table === 'template_slots') return slotsChain();
      if (table === 'template_text_overlays') return overlaysChain();
      throw new Error(`Unexpected table: ${table}`);
    },
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ data: opts.uploadError ? null : { path: 'x' }, error: opts.uploadError ?? null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://cdn.test/templates/x.png' } }),
      }),
    },
  };

  return { client, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
});

describe('AD-003/CS-004: contest-templates admin API', () => {
  it('GET (list) is rejected before any query when the caller lacks votes:manage', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    const res = await listGET(jsonReq('GET'));
    expect(res.status).toBe(403);
  });

  it('POST is rejected before any query when the caller lacks votes:manage', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    const res = await createPOST(jsonReq('POST'));
    expect(res.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('POST rejects a create with a non-image file', async () => {
    const { client } = makeSupabase({});
    vi.mocked(createAdminClient).mockReturnValue(client);

    const file = new File(['not an image'], 'evil.txt', { type: 'text/plain' });
    const res = await createPOST(
      multipartReq({ name: 'Contestant Frame', connectContestId: 'contest-1', file }),
    );
    expect(res.status).toBe(400);
  });

  it('POST create succeeds with status:draft and contest_id:null', async () => {
    const insertedTemplate = {
      id: 'tpl-new', name: 'Contestant Frame', connect_contest_id: 'contest-1', contest_id: null,
      template_url: 'https://cdn.test/templates/x.png', file_format: 'png', width: 1080, height: 1080,
      aspect_ratio: '1:1', status: 'draft', version: 1, created_by: 'admin-1',
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    };
    const { client, calls } = makeSupabase({ insertedTemplate });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const file = new File(['fake-png-bytes'], 'frame.png', { type: 'image/png' });
    const res = await createPOST(
      multipartReq({ name: 'Contestant Frame', connectContestId: 'contest-1', file }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.template.status).toBe('draft');
    expect(body.template.contestId).toBeNull();
    expect(calls.insertPayload).toMatchObject({ status: 'draft', contest_id: null, connect_contest_id: 'contest-1' });
  });

  it('PATCH to active is rejected when the template has no contestant slot', async () => {
    const { client } = makeSupabase({
      templateRow: { id: 'tpl-1', status: 'draft' },
      contestantSlotExists: false,
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemPATCH(jsonReq('PATCH', { status: 'active' }), ctx('tpl-1'));
    expect(res.status).toBe(400);
  });

  it('PATCH to active succeeds when a contestant slot is present', async () => {
    const updatedTemplate = {
      id: 'tpl-1', name: 'Frame', connect_contest_id: 'contest-1', contest_id: null,
      template_url: 'https://cdn/x.png', file_format: 'png', width: 1080, height: 1080,
      aspect_ratio: '1:1', status: 'active', version: 1, created_by: 'admin-1',
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
    };
    const { client, calls } = makeSupabase({
      templateRow: { id: 'tpl-1', status: 'draft' },
      contestantSlotExists: true,
      updatedTemplate,
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemPATCH(jsonReq('PATCH', { status: 'active' }), ctx('tpl-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.template.status).toBe('active');
    expect(calls.updatePayload).toMatchObject({ status: 'active' });
  });

  it('DELETE on an active template is refused with 409', async () => {
    const { client } = makeSupabase({ templateRow: { id: 'tpl-1', status: 'active' } });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemDELETE(jsonReq('DELETE'), ctx('tpl-1'));
    expect(res.status).toBe(409);
  });

  it('DELETE on a draft template succeeds', async () => {
    const { client, calls } = makeSupabase({ templateRow: { id: 'tpl-1', status: 'draft' } });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemDELETE(jsonReq('DELETE'), ctx('tpl-1'));
    expect(res.status).toBe(200);
    expect(calls.deletedFrom).toContain('contest_templates');
  });

  it('DELETE on an archived template succeeds', async () => {
    const { client } = makeSupabase({ templateRow: { id: 'tpl-1', status: 'archived' } });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemDELETE(jsonReq('DELETE'), ctx('tpl-1'));
    expect(res.status).toBe(200);
  });

  it('GET single 404s when the template does not exist', async () => {
    const { client } = makeSupabase({ templateRow: null });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemGET(jsonReq('GET'), ctx('missing'));
    expect(res.status).toBe(404);
  });
});
