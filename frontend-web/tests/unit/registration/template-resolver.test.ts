/**
 * AD-003/CS-004 — resolveActiveTemplateForContest (template-resolver.ts).
 *
 * Mocks @supabase/supabase-js directly (the module builds its own lazy
 * client the same way supabase-store.ts / contest-store.ts do), rather than
 * `@/lib/supabase/server` — this file never imports that module.
 *
 * P2 adds a second `template_slots` read — the decorative foreground slots —
 * and the two are told apart by their terminal rather than by a counter: the
 * contestant row still ends in `maybeSingle()` and the list is awaited
 * directly, which is what supabase-js's own query builder is (`then`). So
 * `state.slotResult` answers one and `state.foregroundResult` the other, and a
 * test that forgot the second gets an empty list rather than a confusing
 * re-answered first one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state: {
  templateResult: any;
  templateError: any;
  slotResult: any;
  slotError: any;
  foregroundResult: any;
  foregroundError: any;
  selected: string[];
} = {
  templateResult: null,
  templateError: null,
  slotResult: null,
  slotError: null,
  foregroundResult: null,
  foregroundError: null,
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
    neq: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => {
      if (table === 'contest_templates') {
        return Promise.resolve({ data: state.templateResult, error: state.templateError });
      }
      return Promise.resolve({ data: state.slotResult, error: state.slotError });
    },
    // Awaiting the builder itself is the list shape, and `then` is what makes
    // one awaitable. The foreground query is the only one that ends here.
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: state.foregroundResult, error: state.foregroundError }),
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
  state.foregroundResult = null;
  state.foregroundError = null;
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

  // ── P2: the blend columns and the foreground art (§8.1, §11) ──────────────

  it('selects the blend columns and the foreground slots', async () => {
    state.templateResult = {
      id: 'tpl-1', version: 3, template_url: 'https://cdn/t.png', width: 1080, height: 1350,
      photo_mode: 'photo_area', blend_preset: 'studio', blend_settings: { edge: { featherPx: 1 } },
    };
    state.slotResult = {
      id: 'slot-1', slot_name: 'Main', slot_type: 'contestant', slot_order: 0,
      x: 10, y: 20, width: 300, height: 400, rotation: 0, z_index: 1, scale: 1,
      crop_mode: 'cover', border_radius: 0, opacity: 1,
      image_url: null, anchor: 'auto', bleed: false, face_protect: true,
    };
    state.foregroundResult = [
      { id: 's2', slot_name: 'Banner', slot_type: 'badge', slot_order: 1,
        x: 0, y: 0, width: 100, height: 40, rotation: 0, z_index: 9, scale: 1,
        crop_mode: 'cover', border_radius: 0, opacity: 1,
        image_url: 'https://cdn/banner.png', anchor: 'auto', bleed: false, face_protect: true },
    ];

    const result = await resolveActiveTemplateForContest('contest-1');
    // The runner reads these four and nothing else from the new columns, so
    // they are part of the resolver's contract from here on.
    expect(result).toMatchObject({
      photoMode: 'photo_area', blendPreset: 'studio', blendSettings: { edge: { featherPx: 1 } },
    });
    expect(result!.foregroundSlots).toHaveLength(1);
    expect(result!.foregroundSlots[0]).toMatchObject({ id: 's2', z_index: 9, image_url: 'https://cdn/banner.png' });
    // §13's geometry rides on the contestant row too: `anchor` and `bleed` are
    // what the placement engine reads, `face_protect` what the compositor does.
    expect(result!.slot).toMatchObject({ anchor: 'auto', bleed: false, face_protect: true });
    // The regression this pins: a query that stopped selecting a column would
    // still get a full row back from the mock, so assert the column lists.
    expect(state.selected.find((s) => s.startsWith('contest_templates:'))).toBe(
      'contest_templates:id, version, template_url, width, height, photo_mode, blend_preset, blend_settings');
    expect(state.selected.find((s) => s.startsWith('template_slots:'))).toMatch(/image_url, anchor, bleed, face_protect/);
  });

  it('tolerates a template with no foreground slots', async () => {
    state.templateResult = {
      id: 'tpl-1', version: 1, template_url: 'https://cdn/t.png', width: 100, height: 100,
      photo_mode: 'background', blend_preset: 'off', blend_settings: null,
    };
    state.slotResult = {
      id: 'slot-1', slot_name: 'Main', slot_type: 'contestant', slot_order: 0,
      x: 0, y: 0, width: 50, height: 50, rotation: 0, z_index: 1, scale: 1,
      crop_mode: 'cover', border_radius: 0, opacity: 1,
      image_url: null, anchor: 'auto', bleed: false, face_protect: true,
    };
    state.foregroundResult = [];

    const result = await resolveActiveTemplateForContest('contest-1');
    expect(result!.blendPreset).toBe('off');
    expect(result!.foregroundSlots).toEqual([]);
  });

  it('still resolves the template when the foreground query fails', async () => {
    // A missing laurel is not a missing template. Returning null here would
    // make the runner fail the job with "the contest has no active template",
    // which describes neither the fault nor the fix, so the contestant keeps
    // the portrait they earned and the art is what is dropped.
    state.templateResult = {
      id: 'tpl-1', version: 2, template_url: 'https://cdn/t.png', width: 100, height: 100,
      photo_mode: 'auto', blend_preset: 'natural', blend_settings: {},
    };
    state.slotResult = {
      id: 'slot-1', slot_name: 'Main', slot_type: 'contestant', slot_order: 0,
      x: 0, y: 0, width: 50, height: 50, rotation: 0, z_index: 1, scale: 1,
      crop_mode: 'cover', border_radius: 0, opacity: 1,
      image_url: null, anchor: 'auto', bleed: false, face_protect: true,
    };
    state.foregroundError = { message: 'connection reset' };

    const result = await resolveActiveTemplateForContest('contest-1');
    expect(result).not.toBeNull();
    expect(result!.templateId).toBe('tpl-1');
    expect(result!.blendPreset).toBe('natural');
    expect(result!.foregroundSlots).toEqual([]);
  });
});
