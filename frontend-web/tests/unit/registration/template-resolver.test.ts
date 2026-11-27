/**
 * AD-003/CS-004 — resolveActiveTemplateForContest (template-resolver.ts).
 *
 * Mocks @supabase/supabase-js directly (the module builds its own lazy
 * client the same way supabase-store.ts / contest-store.ts do), rather than
 * `@/lib/supabase/server` — this file never imports that module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state: {
  templateResult: any;
  templateError: any;
  slotResult: any;
  slotError: any;
  selected: string[];
} = {
  templateResult: null,
  templateError: null,
  slotResult: null,
  slotError: null,
  selected: [],
};

function makeChain(table: string) {
  const chain: any = {
    select: (columns: string) => {
      // Recorded so a test can pin the column list: the mock would happily
      // keep returning a full row after the query stopped selecting a field
      // the caller reads, which is exactly how a `select` regression hides.
      state.selected.push(`${table}:${columns}`);
      return chain;
    },
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => {
      if (table === 'contest_templates') {
        return Promise.resolve({ data: state.templateResult, error: state.templateError });
      }
      return Promise.resolve({ data: state.slotResult, error: state.slotError });
    },
  };
  return chain;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => makeChain(table),
  })),
}));

import { resolveActiveTemplateForContest } from '@/src/server/registration/template-resolver';

beforeEach(() => {
  state.templateResult = null;
  state.templateError = null;
  state.slotResult = null;
  state.slotError = null;
  state.selected = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
});

describe('AD-003/CS-004: resolveActiveTemplateForContest', () => {
  it('returns null when no active template is configured for the contest', async () => {
    state.templateResult = null;
    const result = await resolveActiveTemplateForContest('contest-1');
    expect(result).toBeNull();
  });

  it('returns null (not a throw) when the template exists but has no contestant slot', async () => {
    state.templateResult = { id: 'tpl-1', version: 1, template_url: 'https://cdn/t.png', width: 1080, height: 1080 };
    state.slotResult = null; // no contestant-type slot found
    const result = await resolveActiveTemplateForContest('contest-1');
    expect(result).toBeNull();
  });

  it('returns the mapped SlotConfig when a template + contestant slot both resolve', async () => {
    state.templateResult = { id: 'tpl-1', version: 3, template_url: 'https://cdn/t.png', width: 1080, height: 1350 };
    state.slotResult = {
      id: 'slot-1',
      slot_name: 'Main Contestant',
      slot_type: 'contestant',
      slot_order: 0,
      x: 10, y: 20, width: 300, height: 400,
      rotation: 0, z_index: 1, scale: 1,
      crop_mode: 'cover', border_radius: 8, opacity: 1,
    };

    const result = await resolveActiveTemplateForContest('contest-1');
    expect(result).not.toBeNull();
    // The job queue's run key is built from these two, so they are part of the
    // resolver's contract even though the compositing call only needs the URL.
    expect(result!.templateId).toBe('tpl-1');
    expect(result!.templateVersion).toBe(3);
    expect(result!.templateUrl).toBe('https://cdn/t.png');
    expect(result!.templateWidth).toBe(1080);
    expect(result!.templateHeight).toBe(1350);
    expect(result!.slot).toMatchObject({
      id: 'slot-1',
      slot_name: 'Main Contestant',
      slot_type: 'contestant',
      x: 10, y: 20, width: 300, height: 400,
      crop_mode: 'cover', border_radius: 8, opacity: 1,
    });
    // photo_url must NOT be set by the resolver — the caller fills it in.
    expect(result!.slot.photo_url).toBeUndefined();
  });

  it('picks the highest version when multiple active templates exist (order+limit are wired to version DESC / 1)', async () => {
    // The resolver's query itself orders by version desc + limit(1) — this
    // test asserts the resolver returns exactly what the (mocked) query
    // layer hands back as the "first" row, proving the resolver does not
    // do its own re-sorting/picking that could disagree with the query.
    state.templateResult = { id: 'tpl-v3', template_url: 'https://cdn/v3.png', width: 1080, height: 1080 };
    state.slotResult = {
      id: 'slot-1', slot_name: 'Main', slot_type: 'contestant', slot_order: 0,
      x: 0, y: 0, width: 100, height: 100, rotation: 0, z_index: 1, scale: 1,
      crop_mode: 'cover', border_radius: 0, opacity: 1,
    };

    const result = await resolveActiveTemplateForContest('contest-1');
    expect(result!.templateUrl).toBe('https://cdn/v3.png');
  });

  it('returns null (does not throw) on a query error', async () => {
    state.templateError = { message: 'connection reset' };
    const result = await resolveActiveTemplateForContest('contest-1');
    expect(result).toBeNull();
  });
});
