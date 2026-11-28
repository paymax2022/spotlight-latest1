/**
 * Live proof that a template row the admin console actually wrote can be read,
 * blended and composited by this working tree (plan Task 4).
 *
 * Everything else in `tests/unit/**` answers its question with a stubbed
 * `fetch`, which is exactly how the shipped allowlist managed to look green while
 * refusing every real template. This file answers the same question against the
 * local Supabase stack: it reads the stored `contest_templates.template_url`
 * values over HTTP from `127.0.0.1:54321`, runs the real engine over the real
 * bytes and writes a real composite.
 *
 * It is skipped unless `LIVE_TEMPLATE_PROOF=1`, because CI's unit lane has no
 * database and no storage service, and a live assertion that silently passes in a
 * container that cannot reach either would be worse than no assertion. Run it as:
 *
 *   cd frontend-web
 *   set -a; . ../../../frontend-web/.env.local; set +a
 *   LIVE_TEMPLATE_PROOF=1 npx vitest run tests/unit/photo-jobs/live
 *
 * Read-only against the dev stack except for the composite it writes outside the
 * repository (`$TMPDIR/spotlight-live-blend/`). `storePhoto` is deliberately not
 * exercised: the pipeline's storage write is covered by the job runner's own tests,
 * and dropping stray objects into the shared dev bucket to prove a URL is readable
 * would leave state behind for the next session to explain.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { figurePng } from '../blend/fixtures';
import { readTemplateImage, templateImagePlan } from '@/src/lib/media/template-image';
import { blendSubject } from '@/src/lib/rendering/blend';
import { resolveBlendParams } from '@/src/lib/rendering/blend/params';
import { compositeImage, type SlotConfig } from '@/src/lib/rendering/imageCompositor';

const LIVE = process.env.LIVE_TEMPLATE_PROOF === '1';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

interface TemplateRow {
  id: string;
  version: number;
  status: string;
  template_url: string;
  width: number;
  height: number;
  photo_mode: string | null;
  blend_preset: string | null;
  blend_settings: unknown;
  contestant_slots: number;
}

const outDir = path.join(tmpdir(), 'spotlight-live-blend');
const written: string[] = [];

/**
 * A slot the dev database does not have.
 *
 * `template_slots` is empty in dev — every one of the three stored rows was
 * created by the console's upload step, and authoring a slot is what P3's studio
 * (Tasks 9 and 11) will do from the UI. Inventing the geometry here rather than
 * inserting a row keeps the proof read-only; it is the row's own `width`/`height`
 * and a centered, bottom-anchored figure, which is the shape the engine's placement
 * maths was written for.
 */
const slotFor = (row: TemplateRow): SlotConfig => ({
  id: 'live-harness-slot',
  slot_name: 'contestant',
  slot_type: 'contestant',
  slot_order: 0,
  x: Math.round(row.width * 0.19),
  y: Math.round(row.height * 0.22),
  width: Math.round(row.width * 0.62),
  height: Math.round(row.height * 0.66),
  rotation: 0,
  z_index: 1,
  scale: 1,
  crop_mode: 'cover',
  border_radius: 0,
  opacity: 1,
  anchor: 'bottom',
  bleed: false,
  face_protect: true,
});

/**
 * The P2 fixture's head-and-shoulders figure, at portrait proportion: known head
 * rows, so if the engine's placement disagrees the printed verdict says which
 * measured box it used rather than leaving a photo to explain itself.
 */
const subjectPng = () =>
  figurePng({ w: 400, h: 600, headTop: 60, headWidth: 90, headHeight: 110, bodyWidth: 200, bodyBottom: 540 });

describe.skipIf(!LIVE)('live: composite a console-written template row', () => {
  afterAll(() => {
    if (written.length) console.log(`[live] composites written to ${outDir}: ${written.join(', ')}`);
  });

  it('reads the stored URL, blends it, and writes a composite', async () => {
    expect(SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL must be exported from the dev env').not.toBe('');
    expect(SERVICE_KEY, 'SUPABASE_SERVICE_ROLE_KEY must be exported from the dev env').not.toBe('');
    mkdirSync(outDir, { recursive: true });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data, error } = await supabase
      .from('contest_templates')
      .select('id, version, status, template_url, width, height, photo_mode, blend_preset, blend_settings, template_slots(slot_type)')
      .order('created_at', { ascending: false });
    expect(error, `reading contest_templates: ${error?.message}`).toBeNull();

    const rows: TemplateRow[] = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((raw) => ({
      id: String(raw.id),
      version: Number(raw.version),
      status: String(raw.status),
      template_url: String(raw.template_url),
      width: Number(raw.width),
      height: Number(raw.height),
      photo_mode: (raw.photo_mode as string | null) ?? null,
      blend_preset: (raw.blend_preset as string | null) ?? null,
      blend_settings: raw.blend_settings ?? null,
      contestant_slots: Array.isArray(raw.template_slots) ? raw.template_slots.length : 0,
    }));
    expect(rows.length, 'the dev database has no contest_templates rows').toBeGreaterThan(0);

    const subject = await subjectPng();
    const verdicts = [];

    for (const row of rows) {
      const plan = templateImagePlan(row.template_url);
      const read = await readTemplateImage(row.template_url);
      const verdict: Record<string, unknown> = {
        templateId: row.id,
        status: row.status,
        url: row.template_url,
        plan,
        bytes: read.ok ? read.bytes.byteLength : null,
        readReason: read.ok ? null : read.reason,
        storedSlots: row.contestant_slots,
        slot: row.contestant_slots > 0 ? 'from template_slots' : 'synthesized: dev has no slot rows',
      };

      if (!read.ok) {
        verdicts.push(verdict);
        continue;
      }

      // Same fallback `template-resolver.ts` applies to a NULL column.
      const params = resolveBlendParams(row.blend_preset ?? 'natural', row.blend_settings);
      const blend = await blendSubject({
        subjectPng: subject,
        templatePng: read.bytes,
        canvas: { width: row.width, height: row.height },
        slot: slotFor(row),
        params,
        photoMode: row.photo_mode ?? 'auto',
        overrides: {},
      });
      verdict.applied = blend.decisions.applied;
      verdict.preset = params.preset;
      verdict.decisions = {
        mode: blend.decisions.mode,
        edge: blend.decisions.edge,
        light: blend.decisions.light,
        shadow: blend.decisions.shadow,
        faceProtected: blend.decisions.faceProtected,
      };
      verdict.jpegQuality = blend.jpegQuality;
      verdict.placement = blend.placement?.target ?? null;
      verdict.underlays = blend.underlays.length;
      verdict.faceSafe = blend.faceSafe !== null;

      if (blend.decisions.applied === true) {
        const composited = await compositeImage({
          templateBytes: read.bytes,
          templateWidth: row.width,
          templateHeight: row.height,
          slots: [{ ...slotFor(row), photo_bytes: blend.subjectPng, placement: blend.placement }],
          underlays: blend.underlays,
          faceSafe: blend.faceSafe,
          jpegQuality: blend.jpegQuality,
        });
        const file = path.join(outDir, `${row.id}.${composited.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`);
        writeFileSync(file, composited.buffer);
        written.push(file);
        verdict.composite = { path: file, mimeType: composited.mimeType, width: composited.width, height: composited.height, bytes: composited.buffer.byteLength };
      }
      verdicts.push(verdict);
    }

    console.log('[live] verdicts\n' + JSON.stringify(verdicts, null, 2));

    const readable = verdicts.filter((v) => v.bytes !== null);
    expect(readable.length, `no stored template URL was readable: ${JSON.stringify(verdicts.map((v) => v.readReason))}`).toBeGreaterThan(0);

    const blended = readable.filter((v) => v.applied === true);
    expect(blended.length, 'a readable template row did not reach applied:true').toBeGreaterThan(0);
    expect(blended[0].composite, 'applied:true produced no composite').toBeTruthy();
    const composite = blended[0].composite as { path: string; width: number; height: number; bytes: number };
    expect(composite.width).toBeGreaterThan(0);
    expect(composite.bytes).toBeGreaterThan(1000);

    // The other direction, live: the same URL is a foreign host the moment the
    // configured origin says so, and the read must refuse without going to the network.
    const trusted = SUPABASE_URL;
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://other-project.supabase.co';
      const refused = await readTemplateImage(readable[0].url as string);
      expect(refused.ok, 'a re-pointed origin still accepted the stored URL').toBe(false);
      expect(refused.ok ? null : refused.reason).toBe('host-not-allowed');
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = trusted;
    }
  }, 120_000);
});
