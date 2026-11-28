/**
 * P2 Task 10 — the runner drives the blend engine (spec §4 step 9, §10, §14.11).
 *
 * The harness is `tests/unit/photo-jobs/runner.test.ts`'s, copied rather than
 * imported on purpose: P1's ladder — moderation, extraction, the four asset
 * kinds, the three progress values, the all-or-nothing publish — has to be
 * provable against the stubs it was written against, and the only thing allowed
 * to differ is what the compositing step now does. Read that file for why each
 * mock exists; this one adds a single module boundary (`blendSubject`) and one
 * URL-keyed byte read, then asks §14.11's questions:
 *
 * 1. a `natural` template renders through the engine and the engine's decisions
 *    land on the `final` row's `render_params.blend` — without that record an
 *    operator cannot later tell "matched by 8 %" from "not matched at all";
 * 2. an engine that throws costs the blend, not the portrait: the job still
 *    reaches `ready` and the render is P1's paste (§10's degrade);
 * 3. `blend_preset: 'off'` never reaches the engine at all, so §14.11's
 *    byte-identity claim is about a code path rather than about a parameter that
 *    happens to be arithmetically neutral;
 * 4. the pixels handed to the engine are the cutout and the template, read once
 *    each — the original photograph is not the subject, and a fourth byte read
 *    would mean something inside a claimed job is being fetched twice.
 *
 * `blendSubject` is mocked at its boundary (the maths is `engine.test.ts`'s
 * problem, and it is mocked rather than real so a stub can be made to throw on
 * demand). `resolveBlendParams` is deliberately NOT mocked: the preset-to-
 * numbers table reaching the engine, and the `off` short-circuit in front of it,
 * are exactly what this wiring owns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  getPhotoProvider: vi.fn(),
  moderate: vi.fn(),
  extractBackground: vi.fn(),
  resolveFetchableSource: vi.fn(),
  compositeImage: vi.fn(),
  storePhoto: vi.fn(),
  readAssetBytes: vi.fn(),
  renderVariant: vi.fn(),
  getPhotoAsset: vi.fn(),
  upsertPhotoAsset: vi.fn(),
  setPhotoJobProgress: vi.fn(),
  completePhotoJob: vi.fn(),
  failPhotoJob: vi.fn(),
  cancelPhotoJob: vi.fn(),
  resolveActiveTemplateForContest: vi.fn(),
  blendSubject: vi.fn(),
}));

vi.mock('@/src/lib/media/provider', () => ({ getPhotoProvider: deps.getPhotoProvider }));
vi.mock('@/src/lib/media/asset-source', () => ({ resolveFetchableSource: deps.resolveFetchableSource }));
vi.mock('@/src/lib/rendering/imageCompositor', () => ({ compositeImage: deps.compositeImage }));
vi.mock('@/src/lib/rendering/blend', () => ({ blendSubject: deps.blendSubject }));
vi.mock('@/src/server/photo-jobs/persist', () => ({ storePhoto: deps.storePhoto }));
vi.mock('@/src/server/photo-jobs/assets', () => ({ readAssetBytes: deps.readAssetBytes }));
// `@/src/lib/media/template-image` is deliberately NOT mocked. The P2 suite mocked
// `https://cdn.test/template.png` — a host no configuration in this repo can emit,
// which is how a runner that could not read a real template row stayed green.
// Reading through the real module against a stubbed transport tests the thing that
// was hidden: the URL shape the admin console writes reaching `applied: true`.
vi.mock('@/src/server/photo-jobs/variants', () => ({ renderVariant: deps.renderVariant }));
vi.mock('@/src/server/registration/template-resolver', () => ({
  resolveActiveTemplateForContest: deps.resolveActiveTemplateForContest,
}));
vi.mock('@/src/server/photo-jobs/job-store', () => ({
  getPhotoAsset: deps.getPhotoAsset,
  upsertPhotoAsset: deps.upsertPhotoAsset,
  setPhotoJobProgress: deps.setPhotoJobProgress,
  completePhotoJob: deps.completePhotoJob,
  failPhotoJob: deps.failPhotoJob,
  cancelPhotoJob: deps.cancelPhotoJob,
}));

import { runPhotoJob } from '@/src/server/photo-jobs/runner';
import type { AssetLocation } from '@/src/server/photo-jobs/assets';

const job = {
  id: 'job-1',
  run_key: 'photo:asset-o:tpl-1:abc',
  registration_id: 'reg-1',
  contest_id: 'contest-1',
  template_id: 'tpl-1',
  source_asset_id: 'asset-original',
  status: 'queued',
  progress: 0,
  attempt: 1,
  max_attempts: 6,
  last_error: null,
  render_params: { offsetX: 12 },
  result_asset_id: null,
};

const ORIGINAL = {
  id: 'asset-original',
  kind: 'original',
  storage_key: 'registration/u-1/photo.jpg',
  provider_url: null,
  content_type: 'image/jpeg',
  width: 682,
  height: 1080,
  bytes: 123456,
  render_params: {},
};

function slot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'slot-1', slot_name: 'Main', slot_type: 'contestant', slot_order: 0,
    x: 10, y: 20, width: 300, height: 400, rotation: 0, z_index: 1, scale: 1,
    crop_mode: 'cover', border_radius: 0, opacity: 1, ...overrides,
  };
}

/**
 * The two template URL shapes this app really produces, both from
 * `supabase.storage.from('contest-templates').getPublicUrl(objectKey)` at
 * `app/api/admin/voting/contest-templates/route.ts:205-228`: production's
 * `https://<project>.supabase.co/…` and the dev stack's
 * `http://127.0.0.1:54321/…`, which is the exact string the three rows in the
 * local database hold today. The P2 suite used `https://cdn.test/template.png`,
 * a host nothing in this repo can emit, and the runner's inability to read a
 * real template row was invisible for exactly that reason.
 */
const SUPABASE_ORIGIN = 'https://demo-project.supabase.co';
const TEMPLATE_URL = `${SUPABASE_ORIGIN}/storage/v1/object/public/contest-templates/templates/c2eca087/3491eee5.png`;
const DEV_TEMPLATE_URL = TEMPLATE_URL.replace(SUPABASE_ORIGIN, 'http://127.0.0.1:54321');

/**
 * The template row now carries the blend columns, so the stub does too.
 * `photoMode`/`blendPreset`/`blendSettings`/`foregroundSlots` are what
 * `template-resolver.ts` reads (§11) and the runner reads nothing else from
 * `blend_*`, so a stub that forgot one would be testing a shape the resolver
 * cannot produce.
 */
function template(overrides: Record<string, unknown> = {}) {
  return {
    templateId: 'tpl-1',
    templateVersion: 4,
    templateUrl: TEMPLATE_URL,
    templateWidth: 1080,
    templateHeight: 1350,
    photoMode: 'auto',
    blendPreset: 'natural',
    blendSettings: null,
    foregroundSlots: [],
    slot: slot(),
    ...overrides,
  };
}

/** A §4 output with plausible-looking numbers; engine.test.ts owns their truth. */
const blended = {
  subjectPng: Buffer.from('blended-png'),
  placement: {
    source: { x: 0, y: 0, width: 100, height: 100 },
    target: { left: 10, top: 20, width: 300, height: 400 },
    faceOnCanvas: { x: 120, y: 60, width: 60, height: 80 },
    anchor: 'bottom' as const, mode: 'background' as const, scale: 3,
  },
  underlays: [{ buffer: Buffer.from('drop'), left: -14, top: -4 }],
  faceSafe: { face: { x: 120, y: 60, width: 60, height: 80 }, strength: 0.92 },
  jpegQuality: 90,
  decisions: { applied: true, preset: 'natural', mode: 'background' },
};

beforeEach(() => {
  vi.resetAllMocks();
  deps.getPhotoProvider.mockReturnValue({
    name: 'cloudinary',
    configured: true,
    missing: [],
    extractBackground: deps.extractBackground,
    moderate: deps.moderate,
  });
  deps.moderate.mockResolvedValue({ approved: true });
  deps.extractBackground.mockResolvedValue({ ok: true, resultUrl: 'https://cut.test/x.png' });
  deps.resolveFetchableSource.mockResolvedValue({
    ok: true, url: 'https://signed.test/photo.jpg', objectKey: ORIGINAL.storage_key, ttlSeconds: 600,
  });
  deps.getPhotoAsset.mockResolvedValue(ORIGINAL);
  deps.readAssetBytes.mockResolvedValue(Buffer.from('raw-bytes'));
  deps.resolveActiveTemplateForContest.mockResolvedValue(template());
  deps.compositeImage.mockResolvedValue({
    buffer: Buffer.from('final'), mimeType: 'image/png', width: 1080, height: 1350,
  });
  deps.storePhoto.mockResolvedValue('contestants/composited/uuid.png');
  deps.upsertPhotoAsset.mockResolvedValue('asset-new');
  deps.completePhotoJob.mockResolvedValue(true);
  deps.failPhotoJob.mockResolvedValue('failed');
  deps.renderVariant.mockResolvedValue({
    buffer: Buffer.from('variant'), mimeType: 'image/png', width: 320, height: 400,
  });
});

// P1 reads one thing's bytes — the original, as a liveness probe — and works by
// URL after that. P2 needs pixels, so it reads two more: the vendor cutout, and
// the template. Keying the stub by location makes each read nameable in an
// assertion, which is the only way case 4 below can prove the engine is being
// handed the cutout rather than the photograph.
const fetches: string[] = [];

async function readStoredTemplate(input: unknown): Promise<Response> {
  const url = String(input);
  fetches.push(url);
  if (url === TEMPLATE_URL || url === DEV_TEMPLATE_URL) {
    return new Response(Buffer.from('template-png-bytes'), { status: 200 });
  }
  return new Response('not found', { status: 404 });
}

beforeEach(() => {
  deps.readAssetBytes.mockImplementation(async ({ storage_key, provider_url }: AssetLocation) => {
    if (storage_key === ORIGINAL.storage_key) return Buffer.from('original-bytes');
    if (provider_url === 'https://cut.test/x.png') return Buffer.from('cutout-png-bytes');
    return null;
  });
  deps.blendSubject.mockResolvedValue(blended);
  // The template's own read goes through the real `readTemplateImage`, so the
  // host policy in `@/lib/config` is exercised on the way to it. Anything this
  // suite does not name answers 404, which the reader reports as `http-status`
  // rather than letting a typo pass as a successful read.
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_ORIGIN);
  fetches.length = 0;
  vi.stubGlobal('fetch', readStoredTemplate);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const kinds = () => deps.upsertPhotoAsset.mock.calls.map((call) => call[0].kind);
const finalCall = () => deps.upsertPhotoAsset.mock.calls.find((call) => call[0].kind === 'final')![0];
// A test that runs the job more than once has to read the record that run wrote,
// not the first one the test file ever produced; `find` would silently compare the
// earlier render and make a two-run case prove nothing.
const lastFinalCall = () => deps.upsertPhotoAsset.mock.calls.findLast((call) => call[0].kind === 'final')![0];
const compositorCall = () => deps.compositeImage.mock.calls[0][0];
const lastCompositorCall = () => deps.compositeImage.mock.calls.at(-1)![0];

describe('runPhotoJob with the blend engine', () => {
  it('composites through the blend and records the decisions on the final asset', async () => {
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(deps.blendSubject).toHaveBeenCalledTimes(1);

    const request = deps.blendSubject.mock.calls[0][0];
    expect(request.templatePng).toEqual(Buffer.from('template-png-bytes')); // bytes, not a URL
    expect(request.canvas).toEqual({ width: 1080, height: 1350 });
    expect(request.slot.x).toBe(10);
    expect(request.photoMode).toBe('auto');
    // The §12 table the template's preset names, resolved before the call: a
    // runner that passed the preset string instead would leave the engine to
    // re-read the table it was already handed.
    expect(request.params.preset).toBe('natural');

    const composited = compositorCall();
    expect(composited.templateBytes).toEqual(Buffer.from('template-png-bytes'));
    expect(composited.templateUrl).toBeUndefined();   // the read is paid for: no second fetch
    expect(composited.slots[0].photo_bytes).toEqual(Buffer.from('blended-png'));
    expect(composited.slots[0].placement).toEqual(blended.placement);
    expect(composited.underlays).toEqual(blended.underlays);
    expect(composited.faceSafe).toEqual(blended.faceSafe);
    expect(composited.jpegQuality).toBe(90);          // §9 reaches the encoder

    // §4 step 9: the decision record travels with the portrait, and the job's
    // own params still ride along — P1's row shape is a subset of P2's, not a
    // replacement for it.
    expect(finalCall().renderParams).toEqual({ offsetX: 12, blend: blended.decisions });
    expect(kinds()).toEqual(['transparent', 'final', 'preview', 'thumbnail']);
    expect(kinds()).not.toContain('original');                               // §14.12
  });

  it('degrades to the P1 paste when the blend throws, and still reaches ready', async () => {
    deps.blendSubject.mockRejectedValue(new Error('median exploded'));

    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(deps.compositeImage).toHaveBeenCalledTimes(1);            // rendered, just not blended
    const composited = compositorCall();
    expect(composited.slots[0].photo_url).toBe('https://cut.test/x.png'); // the legacy URL path
    expect(composited).not.toHaveProperty('underlays');
    expect(composited).not.toHaveProperty('faceSafe');
    expect(finalCall().renderParams.blend).toEqual({ applied: false, preset: 'natural', error: 'median exploded' });
  });

  it('skips the engine entirely for preset "off"', async () => {
    deps.resolveActiveTemplateForContest.mockResolvedValue(template({ blendPreset: 'off' }));

    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(deps.blendSubject).not.toHaveBeenCalled();
    // …and the two reads it would have needed are not paid for either: an
    // `off` render costs exactly what main costs, in calls as well as pixels.
    expect(deps.readAssetBytes).toHaveBeenCalledTimes(1);
    expect(fetches).toEqual([]);
    expect(compositorCall().slots[0].photo_url).toBe('https://cut.test/x.png');
    expect(finalCall().renderParams.blend).toEqual({ applied: false, preset: 'off' });
  });

  it('feeds the engine the cutout bytes, never the original', async () => {
    await runPhotoJob(job as never);
    expect(deps.blendSubject.mock.calls[0][0].subjectPng).toEqual(Buffer.from('cutout-png-bytes'));
    expect(deps.blendSubject.mock.calls[0][0].templatePng).toEqual(Buffer.from('template-png-bytes'));
    // The subject and the frame, one read each. A third `readAssetBytes` call, or
    // a subjectPng equal to 'original-bytes', would mean the engine is being
    // handed the photograph itself; the frame is no longer a byte read at all but
    // one fetch of the stored public object, which is what makes it nameable here.
    const reads = deps.readAssetBytes.mock.calls.map((call) => call[0]);
    expect(reads[0]).toMatchObject({ id: 'asset-original' });   // P1's liveness probe, unchanged
    expect(reads.slice(1)).toEqual([{ storage_key: null, provider_url: 'https://cut.test/x.png' }]);
    expect(fetches).toEqual([TEMPLATE_URL]);
  });

  it('degrades to the P1 paste when the cutout is unreadable, naming that reason', async () => {
    // §10's degrade, and the paste is the right answer rather than a failure
    // because the paste fetches the URLs itself: a byte read that came back null
    // on a hiccup still renders, and a genuinely dead cutout URL then fails the
    // way P1 fails — `Compositing failed: …`, with the vendor's own status in it,
    // instead of a portrait built on pixels nobody has.
    deps.readAssetBytes.mockImplementation(async ({ storage_key }: AssetLocation) => {
      if (storage_key === ORIGINAL.storage_key) return Buffer.from('original-bytes');
      return null;
    });
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(deps.blendSubject).not.toHaveBeenCalled();
    expect(compositorCall().slots[0].photo_url).toBe('https://cut.test/x.png');
    expect(finalCall().renderParams.blend).toEqual({
      applied: false, preset: 'natural', error: 'the cutout bytes could not be read',
    });
  });

  it('blends a template row the admin console wrote in production', async () => {
    // The regression the `cdn.test` fixture was hiding: `template_url` is a
    // getPublicUrl() string on this project's own origin, and until the trust rule
    // in `@/lib/config` knew that, every real job degraded here.
    deps.resolveActiveTemplateForContest.mockResolvedValue(template({ templateUrl: TEMPLATE_URL }));
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(fetches).toEqual([TEMPLATE_URL]);
    expect(finalCall().renderParams.blend).toMatchObject({ applied: true, preset: 'natural' });
    expect(compositorCall().templateBytes).toEqual(Buffer.from('template-png-bytes'));
    expect(compositorCall().templateUrl).toBeUndefined();
  });

  it('blends a template row stored on the local dev stack', async () => {
    // The other deployment's shape, and the string the local database actually
    // holds today: plain http on loopback, trusted only because it is *exactly*
    // the configured origin — the same URL refused a moment later under the
    // production origin, which the case below pins.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    deps.resolveActiveTemplateForContest.mockResolvedValue(template({ templateUrl: DEV_TEMPLATE_URL }));
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(fetches).toEqual([DEV_TEMPLATE_URL]);
    expect(finalCall().renderParams.blend).toMatchObject({ applied: true });

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_ORIGIN);
    fetches.length = 0;
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(fetches).toEqual([]);
    expect(lastFinalCall().renderParams.blend).toMatchObject({
      applied: false, error: 'the template bytes could not be read (host-not-allowed)',
    });
    expect(lastCompositorCall().slots[0].photo_url).toBe('https://cut.test/x.png');
  });

  it('names a refused template URL and never fetches it', async () => {
    // A row edited to point somewhere this app will not read is a configuration
    // fault, and the job record has to say so in a way that survives being read
    // months later: no request went out, and the sentence names why.
    deps.resolveActiveTemplateForContest.mockResolvedValue(template({ templateUrl: 'https://evil.test/t.png' }));
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(deps.blendSubject).not.toHaveBeenCalled();
    expect(fetches).toEqual([]);
    expect(finalCall().renderParams.blend).toEqual({
      applied: false, preset: 'natural', error: 'the template bytes could not be read (host-not-allowed)',
    });
  });

  it('names a template object that is not there, apart from a host it will not read', async () => {
    // The two refusals have different fixes — re-point the row, or re-upload the
    // image — so they must not collapse into one sentence.
    deps.resolveActiveTemplateForContest.mockResolvedValue(
      template({ templateUrl: `${SUPABASE_ORIGIN}/storage/v1/object/public/contest-templates/templates/c1/gone.png` }),
    );
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(fetches).toEqual([`${SUPABASE_ORIGIN}/storage/v1/object/public/contest-templates/templates/c1/gone.png`]);
    expect(finalCall().renderParams.blend).toEqual({
      applied: false, preset: 'natural', error: 'the template bytes could not be read (http-status)',
    });
  });

  it('hands the compositor the template\'s foreground slots on every path', async () => {
    // §8's layer order is a property of the template, not of the blend pass: the
    // ribbon belongs over the contestant whether or not the light match ran, so
    // the list travels down all three paths and an empty one leaves P1's call.
    const badge = {
      ...slot(), id: 'badge-1', slot_name: 'Ribbon', slot_type: 'badge', z_index: 5,
      image_url: `${SUPABASE_ORIGIN}/storage/v1/object/public/contest-templates/banners/ribbon.png`,
      anchor: 'auto', bleed: false, face_protect: true,
    };

    deps.resolveActiveTemplateForContest.mockResolvedValue(template({ foregroundSlots: [badge] }));
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(compositorCall().slots.map((s: { id: string }) => s.id)).toEqual(['slot-1', 'badge-1']);
    expect(compositorCall().slots[1]).toMatchObject({ id: 'badge-1', face_protect: true });

    deps.blendSubject.mockRejectedValue(new Error('median exploded'));
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(lastCompositorCall().slots.map((s: { id: string }) => s.id)).toEqual(['slot-1', 'badge-1']);
    expect(lastCompositorCall().slots[1].photo_url).toBeUndefined();

    deps.resolveActiveTemplateForContest.mockResolvedValue(
      template({ blendPreset: 'off', foregroundSlots: [badge] }),
    );
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(lastCompositorCall().slots.map((s: { id: string }) => s.id)).toEqual(['slot-1', 'badge-1']);
    // …and on the `off` path the ribbon's art still rides along, which is the
    // case that used to read the *first* run's input and therefore proved only
    // that the first run worked.
    expect(lastCompositorCall().templateUrl).toBe(
      `${SUPABASE_ORIGIN}/storage/v1/object/public/contest-templates/templates/c2eca087/3491eee5.png`,
    );
  });
});
