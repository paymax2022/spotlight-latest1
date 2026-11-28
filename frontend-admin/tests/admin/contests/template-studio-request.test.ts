/**
 * The console's side of the studio contract, tested where it actually breaks: the
 * request body.
 *
 * `PUT …/slots` is a *replace* — it deletes every slot row and re-inserts the
 * payload. That makes the four art fields (`imageUrl`, `anchor`, `bleed`,
 * `faceProtect`) load-bearing in a way a normal PATCH is not: a body that omits
 * `imageUrl` does not "leave the column alone", it either drops the stored art
 * (if the route trusted it) or is refused by `ownsArt` (which is what the web
 * route does, with 400 `slot_art_would_be_dropped`). The shipped numeric editor
 * sent geometry only, so it worked on art-free templates and 400'd on the others.
 *
 * So this file pins three things at once:
 *   · every slot this client sends states all four fields — including an explicit
 *     `null`, which is the studio's way of clearing art on purpose;
 *   · a slot whose art came from the server round-trips that art instead of
 *     re-uploading or forgetting it;
 *   · a slot that arrives without an `imageUrl` key raises here rather than
 *     becoming a payload that would wipe somebody's ribbon.
 *
 * The lifecycle and preview groups then pin the response shapes the routes
 * actually answer with (`template`/`slots`/`archivedIds`/`changed`/`versions`, the
 * camelCase version chain, `imageUrl` from slot-art), and the rule that a refusal
 * sentence reaches the banner verbatim — including a preview refusal, which is
 * JSON riding back from a route whose success body is an image.
 */
// @vitest-environment node
//
// Node on purpose, and it is not a style choice. This package's default jsdom
// environment cannot start a worker on this machine's Node 22.14.0 at all:
// undici 8.12.3's decompress interceptor evaluates
// `createZstdDecompress.bind(null, …)` at module load, and
// `zlib.createZstdDecompress` does not exist before Node 22.15, so the whole
// jsdom corpus of this app dies before a single test runs. Measured on the
// branch baseline: 18 files / 162 tests pass and 71 files report
// "Failed to start forks worker". Nothing in this file needs a live DOM —
// `renderToStaticMarkup` covers the component side, in template-studio.test.tsx.
import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  archiveContestTemplate,
  duplicateContestTemplate,
  getStudioConfig,
  listContestTemplateVersions,
  previewContestTemplate,
  publishContestTemplate,
  replaceTemplateSlots,
  uploadSlotArt,
  updateContestTemplate,
  type TemplateSlot,
  type TemplateSlotInput,
} from '@/services/contestTemplatesService';

const BASE = 'http://127.0.0.1:3001/api/web-proxy/api/admin/voting/contest-templates';

/** The ten numeric fields the pre-P3 editor sent, and nothing else. */
function geometryOnly(over: Partial<TemplateSlot> = {}): TemplateSlotInput {
  return {
    slotName: 'contestant',
    slotType: 'contestant',
    slotOrder: 0,
    x: 10,
    y: 20,
    width: 300,
    height: 400,
    rotation: 0,
    zIndex: 1,
    scale: 1,
    cropMode: 'cover',
    borderRadius: 8,
    opacity: 1,
    ...over,
  } as TemplateSlotInput;
}

type Recorded = { url: string; init: RequestInit };

function stubFetch(handler: (call: Recorded) => Response | Record<string, unknown>) {
  const calls: Recorded[] = [];
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    const out = handler(call);
    return out instanceof Response ? out : jsonResponse(out);
  }) as unknown as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function bodyOf(call: Recorded): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubEnv('ADMIN_SELF_ORIGIN', 'http://127.0.0.1:3001');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('replaceTemplateSlots states the art fields on every slot', () => {
  it('sends all four fields for a slot that has them', async () => {
    const calls = stubFetch(() => jsonResponse({ success: true, slots: [] }));
    await replaceTemplateSlots('t-1', [
      geometryOnly({ imageUrl: 'https://x.test/a.png', anchor: 'bottom', bleed: true, faceProtect: false }),
    ]);

    const body = bodyOf(calls[0]);
    expect(calls[0].url).toBe(`${BASE}/t-1/slots`);
    expect(calls[0].init.method).toBe('PUT');
    const [slot] = body.slots as Record<string, unknown>[];
    expect(slot).toMatchObject({
      imageUrl: 'https://x.test/a.png',
      anchor: 'bottom',
      bleed: true,
      faceProtect: false,
    });
  });

  it('sends an explicit null when the studio clears the art', async () => {
    const calls = stubFetch(() => jsonResponse({ success: true, slots: [] }));
    await replaceTemplateSlots('t-1', [geometryOnly({ imageUrl: null, anchor: 'auto', bleed: false, faceProtect: true })]);

    const [slot] = bodyOf(calls[0]).slots as Record<string, unknown>[];
    expect(slot.imageUrl).toBeNull();
    // `undefined` would vanish from JSON.stringify and the route would read an
    // omitted key. This is the difference between clearing art and losing it.
    expect(JSON.stringify(slot)).toContain('"imageUrl":null');
  });

  it('refuses to build a body from a slot that never stated its art', async () => {
    const calls = stubFetch(() => jsonResponse({ success: true, slots: [] }));

    // The pre-P3 shape, handed to the new client: no `imageUrl` key at all. The
    // honest answer is to raise here, because the alternative is either a payload
    // the route 400s or one that silently deletes a stored ribbon.
    await expect(replaceTemplateSlots('t-1', [geometryOnly()])).rejects.toThrow(/imageUrl/);
    expect(calls).toHaveLength(0);
  });

  it('drops the client-only _key and id from the wire', async () => {
    const calls = stubFetch(() => jsonResponse({ success: true, slots: [] }));
    await replaceTemplateSlots('t-1', [
      { ...geometryOnly({ imageUrl: null }), id: 'slot-9', _key: 'slot-9' } as TemplateSlotInput,
    ]);

    const [slot] = bodyOf(calls[0]).slots as Record<string, unknown>[];
    expect(slot).not.toHaveProperty('_key');
    expect(slot).not.toHaveProperty('id');
    expect(slot).toHaveProperty('slotName');
  });

  it('trims the slot name the way the editor means it', async () => {
    const calls = stubFetch(() => jsonResponse({ success: true, slots: [] }));
    await replaceTemplateSlots('t-1', [geometryOnly({ slotName: '  Grand Ribbon  ', imageUrl: null })]);

    const [slot] = bodyOf(calls[0]).slots as Record<string, unknown>[];
    expect(slot.slotName).toBe('Grand Ribbon');
  });
});

describe('the studio reads the art fields back off a stored template', () => {
  it('carries the four slot fields and the three studio columns the list route maps', async () => {
    stubFetch(() =>
      jsonResponse({
        templates: [
          {
            id: 't-1',
            name: 'Frame',
            connectContestId: 'c-1',
            templateUrl: 'https://x.test/f.png',
            thumbnailUrl: null,
            status: 'draft',
            version: 2,
            photoMode: 'photo_area',
            blendPreset: 'studio',
            blendSettings: { intensity: 0.4 },
            publishedAt: null,
            slots: [
              {
                id: 's-1',
                slotName: 'ribbon',
                slotType: 'badge',
                slotOrder: 1,
                x: 1,
                y: 2,
                width: 3,
                height: 4,
                rotation: 0,
                zIndex: 5,
                scale: 1,
                cropMode: 'contain',
                borderRadius: 0,
                opacity: 1,
                imageUrl: 'https://x.test/r.png',
                anchor: 'top',
                bleed: true,
                faceProtect: false,
              },
            ],
          },
        ],
      }),
    );

    const { listContestTemplates } = await import('@/services/contestTemplatesService');
    const [template] = await listContestTemplates('c-1');

    expect(template.photoMode).toBe('photo_area');
    expect(template.blendPreset).toBe('studio');
    expect(template.blendSettings).toEqual({ intensity: 0.4 });
    expect(template.publishedAt).toBeNull();
    expect(template.slots[0]).toMatchObject({
      imageUrl: 'https://x.test/r.png',
      anchor: 'top',
      bleed: true,
      faceProtect: false,
    });
  });

  it('states the four art fields even when the row omits them, so a read is saveable', async () => {
    stubFetch((call) =>
      call.url.includes('/slots')
        ? { success: true, slots: [] }
        : jsonResponse({
            templates: [
              {
                id: 't-2',
                name: 'Plain',
                connectContestId: 'c-1',
                templateUrl: 'https://x.test/p.png',
                status: 'draft',
                version: 1,
                slots: [{ id: 's-2', slotName: 'who', slotType: 'contestant', imageUrl: null }],
          },
        ],
      }),
    );

    const { listContestTemplates } = await import('@/services/contestTemplatesService');
    const [template] = await listContestTemplates('c-1');
    // `null` and not `undefined` is the whole difference between "this slot has no
    // art" and "this client does not know about art", and only the first one is
    // saveable.
    expect(template.slots[0].imageUrl).toBeNull();
    // The other three are stated too, at the values the renderer applies when the
    // row predates them: `faceProtect` defaults to *on* (§7), so a template stored
    // before the column existed must not read back as having switched it off — the
    // admin would save the row and silently change every past and future render.
    expect(template.slots[0]).toMatchObject({ anchor: 'auto', bleed: false, faceProtect: true });

    // And the point of stating them on read is that the read is saveable: the row
    // the service just produced must pass the service's own write guard, with the
    // defaults still on the wire rather than stripped as falsy.
    const calls2 = stubFetch((call) => ({ success: true, slots: [] }));
    await replaceTemplateSlots('t-2', template.slots);
    const [sent] = bodyOf(calls2[0]).slots as Record<string, unknown>[];
    expect(sent).toHaveProperty('imageUrl', null);
    expect(sent).toMatchObject({ anchor: 'auto', bleed: false, faceProtect: true });
    expect(sent).not.toHaveProperty('id');
  });
});

describe('lifecycle calls', () => {
  it('duplicate posts to /duplicate and returns the new draft with its slots', async () => {
    const calls = stubFetch(() =>
      jsonResponse(
        {
          success: true,
          templateId: 't-9',
          version: 3,
          template: {
            id: 't-9',
            name: 'Frame (copy)',
            connectContestId: 'c-1',
            templateUrl: 'https://x.test/f.png',
            status: 'draft',
            version: 3,
          },
          slots: [{ id: 's-9', slotName: 'contestant', slotType: 'contestant', imageUrl: null }],
        },
        201,
      ),
    );

    const result = await duplicateContestTemplate('t-1');
    expect(calls[0].url).toBe(`${BASE}/t-1/duplicate`);
    expect(calls[0].init.method).toBe('POST');
    expect(result.version).toBe(3);
    expect(result.template.name).toBe('Frame (copy)');
    expect(result.slots[0].imageUrl).toBeNull();
  });

  it('publish returns the row and the ids the RPC archived', async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        success: true,
        template: { id: 't-1', name: 'F', status: 'active', version: 4, connectContestId: 'c-1', templateUrl: '' },
        archivedIds: ['t-0', 't-minus-1'],
      }),
    );

    const result = await publishContestTemplate('t-1');
    expect(calls[0].url).toBe(`${BASE}/t-1/publish`);
    expect(result.template.status).toBe('active');
    expect(result.archivedIds).toEqual(['t-0', 't-minus-1']);
  });

  it('archive reports changed false when the row was already archived', async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        success: true,
        template: { id: 't-1', name: 'F', status: 'archived', version: 4, connectContestId: 'c-1', templateUrl: '' },
        changed: false,
      }),
    );

    const result = await archiveContestTemplate('t-1');
    expect(calls[0].url).toBe(`${BASE}/t-1/archive`);
    expect(result.changed).toBe(false);
    expect(result.template.status).toBe('archived');
  });

  it('versions reads the camelCase chain, newest first as the RPC ordered it', async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        success: true,
        versions: [
          { id: 't-3', name: 'F v3', version: 3, status: 'active', publishedAt: '2026-11-20T10:00:00Z', createdAt: '2026-11-19T10:00:00Z' },
          { id: 't-2', name: 'F v2', version: 2, status: 'archived', publishedAt: null, createdAt: '2026-11-18T10:00:00Z' },
        ],
      }),
    );

    const chain = await listContestTemplateVersions('t-3');
    expect(calls[0].url).toBe(`${BASE}/t-3/versions`);
    // A read: no method override, no body, and `no-store` — a cached chain is how
    // an admin concludes a rollback did nothing.
    expect(calls[0].init.method).toBeUndefined();
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.cache).toBe('no-store');
    expect(chain.map((v) => v.version)).toEqual([3, 2]);
    expect(chain[0].publishedAt).toBe('2026-11-20T10:00:00Z');
    expect(chain[1].publishedAt).toBeNull();
  });

  it('an empty chain is an answer, not an error', async () => {
    stubFetch(() => jsonResponse({ success: true, versions: [] }));
    await expect(listContestTemplateVersions('t-1')).resolves.toEqual([]);
  });

  it('surfaces the server sentence for a 409 rather than a generic failure', async () => {
    const sentence =
      'This template is active, so its art is fixed (D6). Duplicate it and edit the draft.';
    stubFetch(() => jsonResponse({ success: false, error: sentence, code: 'template_is_published' }, 409));

    await expect(publishContestTemplate('t-1')).rejects.toThrow(sentence);
  });
});

describe('slot art and preview', () => {
  it('uploadSlotArt posts multipart under the field "file" and returns the URL', async () => {
    const calls = stubFetch(() => jsonResponse({ success: true, imageUrl: 'https://x.test/slots/t-1/art.png' }, 201));

    const file = new File([new Uint8Array([1, 2, 3])], 'ribbon.png', { type: 'image/png' });
    const url = await uploadSlotArt('t-1', file);
    expect(calls[0].url).toBe(`${BASE}/t-1/slot-art`);
    expect(calls[0].init.method).toBe('POST');
    expect(url).toBe('https://x.test/slots/t-1/art.png');

    const form = calls[0].init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('file')).toBeInstanceOf(File);
    // No hand-set content type: the boundary belongs to the runtime.
    const headers = (calls[0].init.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('content-type');
  });

  it('preview posts the sample under "sample" with the overrides the route reads', async () => {
    const calls = stubFetch(
      () =>
        new Response(new NodeBlob([new Uint8Array([9, 9])], { type: 'image/jpeg' }) as unknown as BlobPart, {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'x-blend-applied': 'true',
            'x-render-decisions': encodeURIComponent(JSON.stringify({ applied: true, placement: { target: { left: 4 } } })),
          },
        }),
    );

    const sample = new File([new Uint8Array([1])], 'cutout.png', { type: 'image/png' });
    const result = await previewContestTemplate('t-1', {
      sample,
      photoMode: 'photo_area',
      blendPreset: 'bold',
      blendSettings: { intensity: 0.7 },
      xOffset: 40,
    });

    const form = calls[0].init.body as FormData;
    expect(form.get('sample')).toBeInstanceOf(File);
    expect(form.get('photoMode')).toBe('photo_area');
    expect(form.get('blendPreset')).toBe('bold');
    expect(JSON.parse(String(form.get('blendSettings')))).toEqual({ intensity: 0.7 });
    expect(form.get('xOffset')).toBe('40');
    expect(form.get('yOffset')).toBeNull();

    expect(result.contentType).toBe('image/jpeg');
    expect(result.applied).toBe(true);
    expect(result.decisions).toMatchObject({ applied: true, placement: { target: { left: 4 } } });
    expect(result.blob.size).toBe(2);
  });

  it('reads a refusal out of the preview route that answers 200 with bytes', async () => {
    stubFetch(() =>
      jsonResponse(
        { success: false, error: 'The preview needs a cut-out — a portrait with transparent pixels.', code: 'sample_needs_cutout' },
        415,
      ),
    );

    await expect(
      previewContestTemplate('t-1', { sample: new File([new Uint8Array([1])], 'photo.jpg', { type: 'image/jpeg' }) }),
    ).rejects.toThrow(/cut-out/);
  });

  it('applied false comes through as false, not as a missing header', async () => {
    stubFetch(
      () =>
        new Response(new NodeBlob([new Uint8Array([9])], { type: 'image/png' }) as unknown as BlobPart, {
          status: 200,
          headers: { 'content-type': 'image/png', 'x-blend-applied': 'false', 'x-render-decisions': '%7B%22applied%22%3Afalse%7D' },
        }),
    );

    const result = await previewContestTemplate('t-1', { sample: new File([new Uint8Array([1])], 'c.png', { type: 'image/png' }) });
    expect(result.applied).toBe(false);
    expect(result.decisions).toEqual({ applied: false });
  });

  it('treats a 200 that never stated a verdict as not applied', async () => {
    // `X-Blend-Applied` is the only place the route says whether blending ran, and
    // a proxy between the console and the BFF can drop a custom header. Reading an
    // absent header as "applied" would put a claim in the panel that no response
    // made, so silence is the conservative answer — while the image bytes, which
    // are the actual result, still come through.
    stubFetch(
      () =>
        new Response(new NodeBlob([new Uint8Array([7, 7, 7])], { type: 'image/png' }) as unknown as BlobPart, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
    );

    const result = await previewContestTemplate('t-1', { sample: new File([new Uint8Array([1])], 'c.png', { type: 'image/png' }) });
    expect(result.applied).toBe(false);
    expect(result.decisions).toEqual({});
    expect(result.contentType).toBe('image/png');
    expect(result.blob.size).toBe(3);
  });
});

describe('getStudioConfig', () => {
  it('hands the panel the renderer tables and the template census together', async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        success: true,
        provider: { configured: true, name: 'cloudinary' },
        templates: { counted: true, activeCount: 2, readableCount: 1, refusedCount: 1, source: 'url-shape' },
        blend: {
          presets: ['natural', 'studio', 'bold', 'off'],
          bounds: { intensity: [0, 1], featherPx: [0, 2] },
          modes: ['auto', 'background', 'photo_area'],
          anchors: ['auto', 'top', 'centre', 'bottom'],
          shadowModes: ['auto', 'on', 'off'],
        },
        blockers: [],
      }),
    );

    const config = await getStudioConfig();
    expect(calls[0].url).toBe('http://127.0.0.1:3001/api/web-proxy/api/admin/photo-config-status');
    expect(config.blend.presets).toEqual(['natural', 'studio', 'bold', 'off']);
    expect(config.blend.bounds.featherPx).toEqual([0, 2]);
    expect(config.blend.anchors).toContain('centre');
    expect(config.templates).toMatchObject({ counted: true, refusedCount: 1 });
    expect(config.blockers).toEqual([]);
  });

  it('sends the studio fields a PATCH accepts, and only those the caller named', async () => {
    const calls = stubFetch(() =>
      jsonResponse({ success: true, template: { id: 't-1', name: 'F', status: 'draft', version: 1, connectContestId: 'c-1', templateUrl: '' } }),
    );

    await updateContestTemplate('t-1', { blendPreset: 'studio', blendSettings: { intensity: 0.25 }, photoMode: 'auto' });
    const body = bodyOf(calls[0]);
    expect(body).toEqual({ blendPreset: 'studio', blendSettings: { intensity: 0.25 }, photoMode: 'auto' });
    expect(body).not.toHaveProperty('blend_settings');
  });
});
