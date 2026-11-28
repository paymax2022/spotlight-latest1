/**
 * The studio panel's shape, asserted on real rendered markup.
 *
 * Why static markup and not `@testing-library/react`: this app's default vitest
 * environment is jsdom, and jsdom cannot start a worker on Node 22.14.0 — undici
 * 8.12.3 binds `zlib.createZstdDecompress` at module load and that function only
 * exists from Node 22.15. Measured on the branch baseline: 18 files / 162 tests
 * pass, 71 files die with "Failed to start forks worker". `renderToStaticMarkup`
 * needs no DOM and no undici, so these assertions run everywhere, and they cover
 * the things that were actually at risk in this component: which controls exist,
 * what numbers they carry, and whether a locked row renders as locked.
 *
 * What is deliberately *not* claimed here: clicks and typing. The panel is kept a
 * pure function of its props (no state, no effects, no service import), so the
 * initial render *is* every render — which is also why it receives `config`
 * instead of fetching it.
 *
 * The fixture's bounds, presets and enums are the real ones, copied from
 * `frontend-web/src/lib/rendering/blend/params.ts` (`BOUNDS`, `PRESETS`) via the
 * `/api/admin/photo-config-status` response shape. A fixture invented with
 * photography words — exposure, saturation — would have proven nothing about the
 * table the console actually gets, and would have hidden that `shadow` is a
 * setting with no numeric bound and therefore needs its own control.
 */
// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import TemplateStudio, { rangeFields } from '../../../app/admin/voting/templates/TemplateStudio';
import type {
  ContestTemplate,
  StudioConfig,
  TemplateSlot,
} from '@/services/contestTemplatesService';

const CONFIG: StudioConfig = {
  blend: {
    presets: ['natural', 'studio', 'bold', 'off'],
    bounds: {
      subjectFill: [0.5, 1],
      featherPx: [0, 2],
      speckleMinArea: [0, 400],
      holeMaxArea: [0, 400],
      lumaFraction: [0, 1],
      lumaBias: [0.8, 1.2],
      gainMin: [0.5, 1],
      gainMax: [1, 1.25],
      tempMax: [0, 0.09],
      contrastMax: [0, 0.14],
      dropOpacity: [0, 0.28],
      shadowBlurPx: [0, 24],
      shadowOffsetPx: [0, 24],
      contactOpacity: [0, 0.22],
      faceProtectStrength: [0, 1],
      jpegQuality: [85, 95],
    },
    modes: ['auto', 'background', 'photo_area'],
    anchors: ['auto', 'top', 'centre', 'bottom'],
    shadowModes: ['auto', 'on', 'off'],
  },
  templates: { counted: true, activeCount: 1, readableCount: 1, refusedCount: 0 },
  blockers: [],
};

function slot(over: Partial<TemplateSlot> = {}): TemplateSlot {
  return {
    id: 's-1',
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
    imageUrl: null,
    anchor: 'auto',
    bleed: false,
    faceProtect: true,
    ...over,
  };
}

function template(over: Partial<ContestTemplate> = {}): ContestTemplate {
  return {
    id: 't-1',
    name: 'Grand Finale Frame',
    connectContestId: 'c-1',
    templateUrl: 'https://x.test/frame.png',
    thumbnailUrl: null,
    width: 1080,
    height: 1350,
    aspectRatio: '4:5',
    status: 'draft',
    version: 2,
    createdAt: null,
    photoMode: 'auto',
    blendPreset: 'natural',
    blendSettings: { jpegQuality: 92 },
    publishedAt: null,
    slots: [slot()],
    textOverlays: [],
    ...over,
  };
}

const noop = () => undefined;

function render(over: Partial<ComponentProps<typeof TemplateStudio>> = {}) {
  return renderToStaticMarkup(
    <TemplateStudio
      template={template()}
      slots={[slot()]}
      config={CONFIG}
      busy={false}
      error={null}
      notice={null}
      preview={null}
      versions={null}
      onStudioChange={noop}
      onSlotField={noop}
      onUploadArt={noop}
      onSave={noop}
      onPreview={noop}
      onPublish={noop}
      onDuplicate={noop}
      onArchive={noop}
      onShowHistory={noop}
      {...over}
    />,
  );
}

/**
 * One control's opening tag, found by its action rather than by attribute order.
 *
 * React's server renderer emits attributes in declaration order but moves a few
 * (`value` lands last on an input, `selected` after `value` on an option), so
 * pinning a whole tag as a string would test React's serializer instead of this
 * component. `data-action` is the panel's own contract.
 */
function tag(html: string, action: string): string {
  return html.match(new RegExp(`<(?:button|select|input)[^>]*data-action="${action}"[^>]*>`))?.[0] ?? '';
}

describe('rangeFields', () => {
  it('is exactly what the renderer published, in a stable order', () => {
    expect(rangeFields(CONFIG).map(([key]) => key)).toEqual(Object.keys(CONFIG.blend.bounds).sort());
  });

  it('is empty with no config, so no slider list gets invented', () => {
    expect(rangeFields(null)).toEqual([]);
  });
});

describe('the blend section is built from the fetched config', () => {
  it('renders one range input per published bound, with that bound as min/max', () => {
    const html = render();
    for (const [key, [min, max]] of rangeFields(CONFIG)) {
      expect(html).toContain(`data-field="${key}"`);
      expect(html).toContain(`min="${min}"`);
      expect(html).toContain(`max="${max}"`);
    }
    expect(html.match(/type="range"/g)).toHaveLength(rangeFields(CONFIG).length);
  });

  it('shows the stored value for a key the row overrides, and says the rest are not overridden', () => {
    const html = render();
    const stored = html.match(/data-field="jpegQuality"[^>]*/)?.[0] ?? '';
    expect(stored).toContain('value="92"');
    expect(stored).toContain('data-set="true"');
    // An unset knob has no stored number, so the panel must not imply it does:
    // it sits mid-range and is labelled as unset. (The number a render actually
    // uses for it comes from the preset and is reported by the save response.)
    const feather = html.match(/data-field="featherPx"[^>]*/)?.[0] ?? '';
    expect(feather).toContain('min="0"');
    expect(feather).toContain('max="2"');
    expect(feather).toContain('data-set="false"');
    expect(html).toContain('not overridden');
  });

  it('clamps a stored value outside the published bound instead of drawing a broken slider', () => {
    const html = render({ template: template({ blendSettings: { jpegQuality: 999 } }) });
    const quality = html.match(/data-field="jpegQuality"[^>]*/)?.[0] ?? '';
    expect(quality).toContain('min="85"');
    expect(quality).toContain('max="95"');
    expect(quality).toContain('value="95"');
    expect(html).toContain('outside the range the renderer uses');
  });

  it('renders nothing about blend while the config is still loading', () => {
    const html = render({ config: null });
    expect(html).not.toContain('type="range"');
    expect(html).toContain('Loading studio configuration');
  });

  it('offers exactly the published presets, with the row\'s own one selected', () => {
    const html = render({ template: template({ blendPreset: 'bold' }) });
    for (const preset of CONFIG.blend.presets) {
      // The option's own text is the contract; `selected` is React's, and lands
      // between `value` and the label for the row's current preset only.
      expect(html).toMatch(new RegExp(`<option value="${preset}"( selected="")?>${preset}</option>`));
    }
    // Selection is asserted through the panel's own contract, not through
    // whatever spelling `renderToStaticMarkup` happens to pick for `selected`.
    expect(html).toContain('data-action="blendPreset" data-selected="bold"');
    expect(html.match(/<option value="/g)).toHaveLength(
      CONFIG.blend.presets.length +
        CONFIG.blend.modes.length +
        CONFIG.blend.anchors.length +
        CONFIG.blend.shadowModes.length,
    );
  });

  it('offers the published photo modes and no invented ones', () => {
    const html = render({ template: template({ photoMode: 'photo_area' }) });
    expect(html).toContain('data-action="photoMode" data-selected="photo_area"');
    expect(html).not.toContain('<option value="photo_window">');
  });

  it('gives the shadow setting a control, because it has no numeric bound', () => {
    const html = render({ template: template({ blendSettings: { shadow: 'on' } }) });
    expect(html).toContain('data-action="shadow" data-selected="on"');
    expect(html).not.toContain('data-field="shadow"');
  });
});

describe('slot art', () => {
  it('names the slot, offers the published anchors, and reflects bleed and face protect', () => {
    const html = render({
      slots: [slot({ slotName: 'ribbon', anchor: 'centre', bleed: true, faceProtect: false })],
    });
    expect(html).toContain('ribbon');
    expect(html).toContain('data-action="anchor" data-selected="centre"');
    expect(html).toContain('data-action="bleed" data-on="true"');
    expect(html).toContain('data-action="faceProtect" data-on="false"');
    // And they really are checkboxes, so the panel is not drawing a text field
    // the admin has to type "true" into.
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
  });

  it('shows the stored art as an image and offers a replace, so an admin can see what is at risk', () => {
    const html = render({ slots: [slot({ imageUrl: 'https://x.test/ribbon.png' })] });
    expect(html).toContain('src="https://x.test/ribbon.png"');
    expect(html).toContain('Remove art');
    expect(html).toContain('data-art="known"');
  });

  it('says a slot has no art instead of rendering an empty image', () => {
    const html = render({ slots: [slot({ imageUrl: null })] });
    expect(html).not.toContain('<img src=""');
    expect(html).toContain('No slot art');
  });

  it('refuses to render art controls for a slot that did not state its art', () => {
    // The one input shape that would let a replace delete art: a draft with the
    // key missing entirely (an old code path, or a hand-built object). Saving it
    // is the service's job to refuse, so the panel shows no controls it could
    // only get wrong.
    const legacy = { ...slot(), imageUrl: undefined } as unknown as TemplateSlot;
    const html = render({ slots: [legacy] });
    expect(html).toContain('art state unknown');
    expect(html).not.toContain('data-action="anchor"');
    expect(html).not.toContain('data-art="known"');
    expect(html).toContain('data-art="unknown"');
    expect(html).not.toContain('Remove art');
  });
});

describe('a published row is read-only, on screen before the 409', () => {
  it.each(['active', 'archived'] as const)('locks every control on a %s template', (status) => {
    const html = render({ template: template({ status, publishedAt: '2026-11-20T10:00:00Z' }) });
    expect(html).toContain('Published rows are read-only');
    expect(html.match(/disabled/g)?.length).toBeGreaterThan(0);
    // Not one writable range on a locked row.
    expect(html.match(/type="range"(?![^>]*disabled)/g) ?? []).toHaveLength(0);
    expect(tag(html, 'blendPreset')).toMatch(/\bdisabled\b/);
    expect(tag(html, 'anchor')).toMatch(/\bdisabled\b/);
    // Duplicating is the way forward, so the button that does it stays live.
    expect(tag(html, 'duplicate')).not.toMatch(/\bdisabled\b/);
  });

  it('leaves the draft unlocked', () => {
    const html = render();
    expect(html).not.toContain('Published rows are read-only');
    expect(html.match(/type="range"(?![^>]*disabled)/g)?.length).toBe(rangeFields(CONFIG).length);
  });
});

describe('lifecycle and results', () => {
  it('offers publish on a draft that has a contestant slot', () => {
    const html = render();
    expect(tag(html, 'publish')).not.toMatch(/\bdisabled\b/);
  });

  it('locks publish on the row that is already active, and says so', () => {
    const html = render({ template: template({ status: 'active', publishedAt: '2026-11-20T10:00:00Z' }) });
    expect(tag(html, 'publish')).toMatch(/\bdisabled\b/);
    expect(html).toContain('already the active version');
  });

  it('refuses to offer publish without a contestant slot, and says why', () => {
    const html = render({ slots: [slot({ slotType: 'badge', slotName: 'ribbon' })] });
    expect(tag(html, 'publish')).toMatch(/\bdisabled\b/);
    expect(html).toContain('needs a contestant slot');
  });

  it('locks archive on a draft — there is nothing live to step down', () => {
    expect(tag(render(), 'archive')).toMatch(/\bdisabled\b/);
    expect(tag(render({ template: template({ status: 'active' }) }), 'archive')).not.toMatch(/\bdisabled\b/);
  });

  it('shows a server sentence verbatim in the error banner', () => {
    const sentence =
      'A active template is the row past renders were produced from, so its blend and photo settings are read-only. Duplicate it to edit: the copy comes back as a new draft with a new version and the same slots.';
    const html = render({ error: sentence });
    expect(html).toContain(sentence);
    // No invented wrapper text standing in for, or competing with, what the API said.
    expect(html).not.toContain('Preview failed');
  });

  it('renders the notice sentence separately from an error', () => {
    const html = render({ notice: 'Published v3. One previous template was archived.' });
    expect(html).toContain('Published v3. One previous template was archived.');
  });

  it('takes the preview sample and the art from the admin, never invents either (D4)', () => {
    const html = render();
    expect(tag(html, 'preview-sample')).toContain('type="file"');
    expect(tag(html, 'upload-art')).toContain('type="file"');
    // No preview image exists until a preview has been asked for.
    expect(html).not.toContain('<img src="blob:');
  });

  it('shows the config blockers and the art census the config was fetched for', () => {
    const html = render({
      config: {
        ...CONFIG,
        blockers: ['BLEND_EDGE_BASE_URL is not set, so no job can reach the edge.'],
        templates: {
          counted: true,
          activeCount: 4,
          readableCount: 3,
          refusedCount: 1,
          refused: [{ name: 'Broken frame', host: 'files.example.test', reason: 'host_not_allowed' }],
        },
      },
    });
    expect(html).toContain('BLEND_EDGE_BASE_URL is not set, so no job can reach the edge.');
    expect(html).toContain('3 of 4');
    expect(html).toContain('files.example.test');
  });

  it('says nothing about the census when the read failed rather than reporting zero', () => {
    const html = render({ config: { ...CONFIG, templates: { counted: false, code: '42501' } } });
    expect(html).not.toMatch(/\d+ of \d+/);
    expect(html).toContain('could not be read');
  });

  it('marks the preview verdict with the words the header carries', () => {
    expect(render({ preview: { url: 'blob:x', applied: true } })).toContain('blend applied');
    expect(render({ preview: { url: 'blob:x', applied: false } })).toContain('blend declined');
    expect(render({ preview: null })).not.toContain('blend applied');
  });

  it('lists history with the version and when, and never-published as itself', () => {
    const html = render({
      versions: [
        { id: 't-3', name: 'F v3', version: 3, status: 'active', publishedAt: '2026-11-20T10:00:00Z', createdAt: '2026-11-19T10:00:00Z' },
        { id: 't-2', name: 'F v2', version: 2, status: 'archived', publishedAt: null, createdAt: '2026-11-18T10:00:00Z' },
      ],
    });
    expect(html).toContain('v3');
    expect(html).toContain('2026-11-20T10:00:00Z');
    expect(html).toContain('never published');
  });

  it('says an empty chain is the first version, which is an answer', () => {
    const html = render({ versions: [] });
    expect(html).toContain('No earlier versions');
  });

  it('dims every action while a call is in flight, so a double press cannot queue two publishes', () => {
    const html = render({ busy: true });
    expect(html).toContain('Saving…');
    expect(html.match(/type="range"(?![^>]*disabled)/g) ?? []).toHaveLength(0);
    expect(tag(html, 'publish')).toMatch(/\bdisabled\b/);
  });
});

describe('the panel is a pure function of its props', () => {
  it('calls no service and holds no state of its own', async () => {
    const src = await import('node:fs/promises').then((m) =>
      m.readFile(new URL('../../../app/admin/voting/templates/TemplateStudio.tsx', import.meta.url), 'utf8'),
    );
    expect(src).toContain("'use client'");
    // No I/O and no local state: the page owns the draft, so what the admin sees
    // after a change is a re-render from props rather than a second copy of the
    // truth that can drift from it.
    for (const forbidden of ['fetch(', 'useEffect(', 'useState(', 'XMLHttpRequest']) {
      expect(src).not.toContain(forbidden);
    }
    // Types from the service are erased at build time and are the right source of
    // the wire shape; importing its functions would give this file a second owner
    // of the slot rules and make it unrenderable without a DOM.
    expect(src).not.toMatch(/import\s+(?!type\b)[^;]*from\s+'@\/services\/[^']+'/);
  });

  it('still renders with empty slots and no config rather than throwing during a page load', () => {
    expect(() =>
      renderToStaticMarkup(
        <TemplateStudio
          template={template()}
          slots={[]}
          config={null}
          busy={false}
          error={null}
          notice={null}
          preview={null}
          versions={null}
          onStudioChange={noop}
          onSlotField={noop}
          onUploadArt={noop}
          onSave={vi.fn()}
          onPreview={vi.fn()}
          onPublish={vi.fn()}
          onDuplicate={vi.fn()}
          onArchive={vi.fn()}
          onShowHistory={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });
});
