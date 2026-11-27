# Contest photo blend layer (P2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the paste-the-cutout renderer with a measured blend engine — subject-aware placement, edge refinement, per-contestant colour/light matching, silhouette shadows, face-safe foreground layering and a chosen encode — inside the P1 job runner, without ever writing to an `original` asset.

**Architecture:** Seven focused modules under `frontend-web/src/lib/rendering/blend/` do the image science on buffers and are unit-tested against synthetic images whose geometry the test planted. `imageCompositor.ts` stays the only renderer and gains caller-supplied bytes, an explicit placement override, underlays and a face-safe clip. `photo-jobs/runner.ts` is the sole production caller of the blend: it reads the bytes it already has, calls the engine, passes the result to the compositor, and records what was applied on the `final` asset row. A throw anywhere in the engine degrades to P1's existing paste; it never fails a job and never publishes a partial portrait.

**Tech Stack:** `sharp` 0.35.5 / libvips 8.18.7 (operator availability and two band-handling traps measured in spec §2), TypeScript, vitest 5, Postgres additive columns, Supabase `rpc()` (unchanged from P1).

**Spec:** [docs/superpowers/specs/2026-11-27-contest-photo-blend-layer-design.md](./2026-11-27-contest-photo-blend-layer-design.md) — the math (§5–§9, §12, §13) is normative; this plan cites it rather than repeating it.

## Global Constraints

- Never overwrite the original photograph. No code path in P2 writes an `original` asset row, and the `contest_photo_assets_immutable` trigger must still refuse one (spec §4, §14.12).
- No new npm dependency. No new vendor call. No new service. libvips and TypeScript only.
- Every blend parameter is bounded by the preset table (spec §12) and re-clamped on read; an override can narrow a bound, never widen it past the hard ceiling stated in the spec.
- Colour/light correction is computed per image pair and the applied numbers are stored on the asset (§6.B's "not identical filters" rule; spec §6.4, §14.5).
- `blend_preset: 'off'` and any engine throw must render exactly what `main` renders today (spec §3, §14.11) — that equivalence is a test, not a hope.
- Migration version must be unique across the whole merge-result tree; this one is `20272200000000` (spec §11).
- Frontend-web has no `pg` dependency: anything touching SQL goes through `supabase.rpc()` against a function from the migration. P2 needs no new function.
- Tests never assert a golden image; they assert the numeric relation the spec claims (spec §14).
- Branch is stacked on `feat/contest-photo-assets-jobs` (P1, PR #1180). Its PR base is that branch, not `main`.

---

### Task 1: Blend configuration columns

**Files:**
- Create: `supabase/migrations/20272200000000_contest_photo_blend.sql`
- Test: `frontend-web/tests/unit/photo-jobs/blend/migration.test.ts`

**Interfaces:**
- Consumes: `contest_templates` / `template_slots` as created by `20260405700000_contest_image_templates.sql`.
- Produces: columns `photo_mode`, `blend_preset`, `blend_settings` on `contest_templates`; `image_url`, `anchor`, `bleed`, `face_protect` on `template_slots`. Task 10 reads them.

- [ ] **Step 1: Write the failing test** — read the migration text and assert the contract, then (Step 3) replay it for real:

```ts
// frontend-web/tests/unit/photo-jobs/blend/migration.test.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  fileURLToPath(new URL('../../../../../supabase/migrations/20272200000000_contest_photo_blend.sql', import.meta.url)),
  'utf8',
);

describe('contest photo blend migration', () => {
  it('is additive only', () => {
    // The same vocabulary the reusable migration guard rejects, asserted here so
    // a destructive edit fails in `npm test` rather than only in CI.
    expect(sql).not.toMatch(/\b(drop\s+(table|column|type|schema)|alter\s+\w+\s+drop|rename\s+(column|to))\b/i);
  });

  it('defaults every new column so existing templates keep rendering', () => {
    expect(sql).toMatch(/photo_mode\s+text\s+not null default 'auto'/i);
    expect(sql).toMatch(/blend_preset\s+text\s+not null default 'natural'/i);
    expect(sql).toMatch(/face_protect\s+boolean\s+not null default true/i);
    expect(sql).toMatch(/bleed\s+boolean\s+not null default false/i);
  });

  it('constrains the enums to the values the resolver can return', () => {
    for (const v of ['auto', 'background', 'photo_area']) expect(sql).toContain(`'${v}'`);
    for (const v of ['natural', 'studio', 'bold', 'off']) expect(sql).toContain(`'${v}'`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `cd frontend-web && npx vitest run tests/unit/photo-jobs/blend/migration.test.ts`. Expected: FAIL, ENOENT on the migration path.
- [ ] **Step 3: Write the migration** — exactly the SQL in spec §11, prefixed by the header comment the renumber lesson earned:

```sql
-- Contest photo blend layer (P2): the columns the renderer reads.
-- Additive only; every default keeps today's behaviour reachable.
-- Version note: 20272100000000 is P1's photo asset/job table and
-- 20272000000000 is main's locality_villages. Per
-- scripts/ci/check-migration-versions.sh the NEWCOMER moves: if `main` gains a
-- 202722* version while this PR is open, renumber this file to a version after
-- the new maximum and re-run the merged-chain replay in Task 11 Step 4 — a
-- duplicate version is silently skipped by `db push`, which is a post-merge
-- outage rather than a pre-merge error.
ALTER TABLE public.contest_templates
  ADD COLUMN IF NOT EXISTS photo_mode text NOT NULL DEFAULT 'auto'
    CHECK (photo_mode IN ('auto', 'background', 'photo_area')),
  ADD COLUMN IF NOT EXISTS blend_preset text NOT NULL DEFAULT 'natural'
    CHECK (blend_preset IN ('natural', 'studio', 'bold', 'off')),
  ADD COLUMN IF NOT EXISTS blend_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.template_slots
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS anchor text NOT NULL DEFAULT 'auto'
    CHECK (anchor IN ('auto', 'top', 'centre', 'bottom')),
  ADD COLUMN IF NOT EXISTS bleed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS face_protect boolean NOT NULL DEFAULT true;
```

- [ ] **Step 4: Run the version and parameter guards, then the test** — `bash scripts/ci/check-migration-versions.sh` (expected: "all versions unique", rc 0), `python3 scripts/ci/check-sql-param-order.py supabase/migrations` (expected: rc 0), `npx vitest run tests/unit/photo-jobs/blend/migration.test.ts` (expected: 3 passing).
- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20272200000000_contest_photo_blend.sql frontend-web/tests/unit/photo-jobs/blend/migration.test.ts
git commit -m "feat(photo): store the blend layer's mode, preset and placement columns"
```

---

### Task 2: Presets and bounds

**Files:**
- Create: `frontend-web/src/lib/rendering/blend/params.ts`
- Test: `frontend-web/tests/unit/photo-jobs/blend/params.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BlendParams` (the §12 table as a flat typed object), `resolveBlendParams(presetName: string, overrides?: unknown): BlendParams`, `isBlendDisabled(p: BlendParams): boolean`. Every later task takes `BlendParams` — no task reads a raw string again.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { isBlendDisabled, resolveBlendParams } from '@/src/lib/rendering/blend/params';

describe('blend presets', () => {
  it('carries the spec table verbatim', () => {
    const natural = resolveBlendParams('natural');
    expect(natural).toMatchObject({ subjectFill: 0.94, featherPx: 1, speckleMinArea: 24, lumaFraction: 0.45, gainMin: 0.92, gainMax: 1.08, jpegQuality: 90 });
    expect(resolveBlendParams('bold')).toMatchObject({ subjectFill: 1, featherPx: 2, speckleMinArea: 6, gainMax: 1.25, jpegQuality: 92 });
  });

  it('treats an unknown preset name as natural, not as an error', () => {
    // A template row written by a future UI must never fail a render.
    expect(resolveBlendParams('vivid').subjectFill).toBe(0.94);
    expect(resolveBlendParams('').subjectFill).toBe(0.94);
  });

  it('keeps "off" as the only way to disable the engine', () => {
    expect(isBlendDisabled(resolveBlendParams('off'))).toBe(true);
    expect(isBlendDisabled(resolveBlendParams('natural'))).toBe(false);
  });

  it('applies numeric overrides and clamps them to the hard ceiling', () => {
    expect(resolveBlendParams('natural', { gainMax: 1.3 }).gainMax).toBe(1.25); // §6.3 ceiling
    expect(resolveBlendParams('natural', { featherPx: 50 }).featherPx).toBe(2); // §5.3 ceiling
    expect(resolveBlendParams('natural', { dropOpacity: 0.9 }).dropOpacity).toBe(0.28); // §7 ceiling
    expect(resolveBlendParams('natural', { jpegQuality: 10 }).jpegQuality).toBe(85);
  });

  it('ignores garbage instead of trusting it', () => {
    const p = resolveBlendParams('natural', { gainMax: 'wide open', shadow: 'yes', unknown: 1 });
    expect(p.gainMax).toBe(1.08);
    expect(p.shadow).toBe('auto');
    expect(p.faceProtectStrength).toBeCloseTo(0.92, 2);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/photo-jobs/blend/params.test.ts` → module not found.
- [ ] **Step 3: Write `params.ts`** — the table plus a declarative bound list, so the ceiling is one list rather than a dozen `Math.min` calls scattered later:

```ts
export type BlendPresetName = 'natural' | 'studio' | 'bold' | 'off';

/** The §12 table, verbatim. Every number a render may use lives here. */
const PRESETS: Record<BlendPresetName, BlendParams> = {
  natural: { preset: 'natural', subjectFill: 0.94, featherPx: 1, speckleMinArea: 24, holeMaxArea: 24,
    lumaFraction: 0.45, lumaBias: 0.97, gainMin: 0.92, gainMax: 1.08, tempMax: 0.04, contrastMax: 0.06,
    dropOpacity: 0.10, shadowBlurPx: 12, shadowOffsetPx: 10, contactOpacity: 0.12,
    faceProtectStrength: 0.92, shadow: 'auto', jpegQuality: 90 },
  studio: { preset: 'studio', subjectFill: 1.00, featherPx: 2, speckleMinArea: 12, holeMaxArea: 40,
    lumaFraction: 0.65, lumaBias: 1.00, gainMin: 0.88, gainMax: 1.12, tempMax: 0.06, contrastMax: 0.10,
    dropOpacity: 0.14, shadowBlurPx: 18, shadowOffsetPx: 14, contactOpacity: 0.16,
    faceProtectStrength: 0.85, shadow: 'auto', jpegQuality: 90 },
  bold: { preset: 'bold', subjectFill: 1.00, featherPx: 2, speckleMinArea: 6, holeMaxArea: 60,
    lumaFraction: 0.80, lumaBias: 1.03, gainMin: 0.80, gainMax: 1.25, tempMax: 0.09, contrastMax: 0.14,
    dropOpacity: 0.18, shadowBlurPx: 24, shadowOffsetPx: 18, contactOpacity: 0.22,
    faceProtectStrength: 0.70, shadow: 'auto', jpegQuality: 92 },
  // 'off' is not a look — it is the absence of the engine, so every number is
  // the identity value and the runner short-circuits before calling it.
  off: { preset: 'off', subjectFill: 1, featherPx: 0, speckleMinArea: 0, holeMaxArea: 0,
    lumaFraction: 0, lumaBias: 1, gainMin: 1, gainMax: 1, tempMax: 0, contrastMax: 0,
    dropOpacity: 0, shadowBlurPx: 0, shadowOffsetPx: 0, contactOpacity: 0,
    faceProtectStrength: 0, shadow: 'off', jpegQuality: 90 },
};

/** Hard ceilings (spec §5.3, §6.3, §7, §9): an override may narrow these, never pass them. */
const BOUNDS: Record<string, [number, number]> = {
  subjectFill: [0.5, 1], featherPx: [0, 2], speckleMinArea: [0, 400], holeMaxArea: [0, 400],
  lumaFraction: [0, 1], lumaBias: [0.8, 1.2], gainMin: [0.5, 1], gainMax: [1, 1.25],
  tempMax: [0, 0.09], contrastMax: [0, 0.14], dropOpacity: [0, 0.28], shadowBlurPx: [0, 24],
  shadowOffsetPx: [0, 24], contactOpacity: [0, 0.22], faceProtectStrength: [0, 1], jpegQuality: [85, 95],
};
```

`resolveBlendParams` then: pick the preset (unknown → `natural`), copy it, and for each own key of a *plain-object* override apply it only when it passes its bound (numbers clamped into range, `shadow` accepted only from `'auto'|'on'|'off'`, everything else dropped). `isBlendDisabled` is `preset === 'off'`.
- [ ] **Step 4: Run to verify it passes** — 5 passing.
- [ ] **Step 5: Commit** `git add …/params.ts …/params.test.ts && git commit -m "feat(photo): name the blend presets and clamp their bounds"`

---

### Task 3: Subject measurement

**Files:**
- Create: `frontend-web/src/lib/rendering/blend/subject-metrics.ts`
- Create: `frontend-web/tests/unit/photo-jobs/blend/fixtures.ts`
- Test: `frontend-web/tests/unit/photo-jobs/blend/subject-metrics.test.ts`

**Interfaces:**
- Consumes: a transparent PNG buffer.
- Produces:

```ts
export interface Rect { x: number; y: number; width: number; height: number }
export interface SubjectMetrics {
  width: number; height: number;      // the subject image's own pixel size
  bbox: Rect; face: Rect;
  coverage: number;                   // opaque pixels / bbox area
  headTop: number;                    // y of the first row that is part of the subject
  headBottom: number;                 // exclusive: first row whose run width > 1.2 * headWidth, else headTop + headWidth
  headWidth: number;                  // widest row run inside the top 12 % of the bbox
  shoulderY: number | null;           // first row below the head whose width >= 1.8 * headWidth
  bottomY: number;                    // last row that is part of the subject
  silhouetteHeight: number;           // bbox.height, named because spec §13 speaks of it
}
export async function measureSubject(png: Buffer): Promise<SubjectMetrics>;
```

Task 4 uses `bbox`/`headTop`/`shoulderY`/`bottomY` for placement and the face box; Task 8 uses `face` for the protected region; Task 5 uses `bbox` for its fringe ring.

`Rect` is exported from here and imported by Tasks 4–9 rather than redeclared.

- [ ] **Step 1: Write the shared fixtures** — every later test builds its images from these, so the geometry each assertion expects is *planted*, not inferred. Boxes are half-open (`[start, end)`) so a `headWidth: 40` fixture measures exactly 40:

```ts
// frontend-web/tests/unit/photo-jobs/blend/fixtures.ts
import sharp from 'sharp';

export interface Rgba { r: number; g: number; b: number; a: number }
const CLEAR: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/** Raw RGBA -> PNG, so no test depends on a file it cannot read. */
export async function rgbaPng(width: number, height: number, at: (x: number, y: number) => Rgba): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { r, g, b, a } = at(x, y);
      const i = (y * width + x) * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export const transparentPng = (w: number, h: number) => rgbaPng(w, h, () => CLEAR);
export const flatPng = (w: number, h: number, c: Rgba) => rgbaPng(w, h, () => c);

/** Head + shoulders with exactly known rows, centred horizontally. */
export function figurePng(o: { w?: number; h?: number; headTop?: number; headWidth?: number;
  headHeight?: number; bodyWidth?: number; bodyBottom?: number } = {}) {
  const { w = 200, h = 300, headTop = 40, headWidth = 40, headHeight = 50, bodyWidth = 80, bodyBottom = 260 } = o;
  const cx = Math.round(w / 2);
  return rgbaPng(w, h, (x, y) => {
    if (y >= headTop && y < headTop + headHeight && x >= cx - headWidth / 2 && x < cx + headWidth / 2)
      return { r: 220, g: 180, b: 150, a: 255 };
    if (y >= headTop + headHeight && y < bodyBottom && x >= cx - bodyWidth / 2 && x < cx + bodyWidth / 2)
      return { r: 200, g: 160, b: 130, a: 255 };
    return CLEAR;
  });
}

/** Templates: a solid field, and the same field with the photo window cut out. */
export const opaqueTemplate = (size: number) => flatPng(size, size, { r: 20, g: 40, b: 80, a: 255 });
export const holedTemplate = (size: number, hole: { x: number; y: number; width: number; height: number }) =>
  rgbaPng(size, size, (x, y) => (x >= hole.x && x < hole.x + hole.width && y >= hole.y && y < hole.y + hole.height
    ? CLEAR : { r: 20, g: 40, b: 80, a: 255 }));

/** One pixel of a rendered PNG, as [r,g,b] plus its alpha. */
export async function pixelAt(png: Buffer, x: number, y: number): Promise<{ rgb: number[]; a: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { rgb: [data[i], data[i + 1], data[i + 2]], a: data[i + 3] };
}
export const alphaAt = async (png: Buffer, x: number, y: number) => (await pixelAt(png, x, y)).a;

/** Decoded RGBA, for tests that scan many pixels — `alphaAt` decodes per call. */
export async function rawRgba(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, alpha: (x: number, y: number) => data[(y * info.width + x) * 4 + 3] };
}
export const countAlpha = async (png: Buffer, test: (a: number) => boolean) => {
  const { data } = await rawRgba(png);
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (test(data[i])) n++;
  return n;
};
```

- [ ] **Step 2: Write the failing test** — synthetic silhouette, geometry asserted exactly:

```ts
// frontend-web/tests/unit/photo-jobs/blend/subject-metrics.test.ts
import { describe, expect, it } from 'vitest';
import { measureSubject } from '@/src/lib/rendering/blend/subject-metrics';
import { figurePng, transparentPng } from './fixtures';

describe('measureSubject', () => {
  it('recovers the planted geometry', async () => {
    // head [40,90) 40 wide, body [90,260) 80 wide, canvas 200x300 centred on x=100
    const m = await measureSubject(await figurePng());
    expect(m.bbox).toEqual({ x: 60, y: 40, width: 80, height: 220 });
    expect(m.headTop).toBe(40);
    expect(m.headWidth).toBe(40);
    expect(m.shoulderY).toBe(90);                 // first row where width >= 1.8 * headWidth
    expect(m.headBottom).toBe(90);               // exclusive end of the head's own span
    expect(m.silhouetteHeight).toBe(220);        // == bbox.height
    expect(m.bottomY).toBe(259);
    expect(m.coverage).toBeGreaterThan(0.3);      // 80x170 + 40x50 inside an 80x220 box
  });

  it('keeps the face box inside the head and out of the shoulders', async () => {
    const m = await measureSubject(await figurePng());
    expect(m.face.y).toBeGreaterThanOrEqual(m.headTop);
    expect(m.face.y + m.face.height).toBeLessThanOrEqual(m.shoulderY ?? m.bbox.y + m.bbox.height);
    expect(m.face.x).toBeGreaterThanOrEqual(m.bbox.x);
    expect(m.face.width).toBeLessThanOrEqual(m.headWidth);      // protects a face, not a bust
  });

  it('returns an empty bbox rather than throwing on a fully transparent image', async () => {
    const m = await measureSubject(await transparentPng(64, 64));
    expect(m.bbox).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(m.shoulderY).toBeNull();
    expect(m.coverage).toBe(0);
  });

  it('ignores alpha below the measurement threshold when bounding the subject', async () => {
    // A faint 40x40 wash at alpha 6 (< ALPHA_TEST 8) around a planted 20x20 core
    // must not move the bbox — this is what keeps a vendor halo from becoming
    // "the subject" and shrinking the placement.
    const png = await rgbaPng(100, 100, (x, y) => {
      if (x >= 40 && x < 60 && y >= 40 && y < 60) return { r: 10, g: 10, b: 10, a: 255 };
      if (x >= 30 && x < 70 && y >= 30 && y < 70) return { r: 0, g: 0, b: 0, a: 6 };
      return CLEAR;
    });
    expect((await measureSubject(png)).bbox).toEqual({ x: 40, y: 40, width: 20, height: 20 });
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npx vitest run tests/unit/photo-jobs/blend/subject-metrics.test.ts` → module not found.
- [ ] **Step 4: Implement** — one pass over `sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })` reading only band 3 (spec §2 records why the raw descriptor and `.ensureAlpha()` are explicit here):
  - `rowRun[y]` = count of pixels with `alpha >= ALPHA_TEST` (8); `bbox` = min/max x/y over those same pixels; `coverage` = that count divided by the bbox area; `silhouetteHeight = bbox.height`;
  - `headWidth` = max `rowRun` within the top 12 % of the bbox height; `headBottom` = the first `y > headTop` with `rowRun[y] > 1.2 * headWidth`, else `headTop + headWidth` (a bust crop with no shoulder step); `shoulderY` = the first `y >= headBottom` with `rowRun[y] >= 1.8 * headWidth`, else `null`;
  - `face` = spec §8.2's protected box over `span = headBottom − headTop`: `y = headTop + 0.06 × span`, `height = 0.78 × span`, `width = 0.62 × headWidth`, centred on the mean x of the head rows. The constants are named at module top and asserted by *containment*, never by pixel identity, because §3 says the box only ever protects, never crops.
- [ ] **Step 5: Run to verify it passes** — 4 passing.
- [ ] **Step 6: Commit** `git add …/subject-metrics.ts …/fixtures.ts …/subject-metrics.test.ts && git commit -m "feat(photo): measure the contestant silhouette from its own alpha"`

---

### Task 4: Placement and mode (§5)

**Files:**
- Create: `frontend-web/src/lib/rendering/blend/placement.ts`
- Test: `frontend-web/tests/unit/photo-jobs/blend/placement.test.ts`

**Interfaces:**
- Consumes: `SlotConfig`, `SubjectMetrics`, `BlendParams`, template bytes.
- Produces:

```ts
export type PhotoMode = 'background' | 'photo_area';
export interface CanvasSize { width: number; height: number }
export interface Placement {
  source: Rect;                       // crop in subject-pixel space (rounded by the compositor)
  target: { left: number; top: number; width: number; height: number };
  clip?: { left: number; top: number; width: number; height: number };
  faceOnCanvas: Rect;
  anchor: 'top' | 'centre' | 'bottom';
  mode: PhotoMode;
  scale: number;                      // the px-per-subject-px factor actually applied, for the decision record
}
export function planPlacement(i: {
  mode: PhotoMode; slot: SlotConfig; metrics: SubjectMetrics; params: BlendParams;
  canvas: CanvasSize; overrides?: { xOffset?: number; yOffset?: number; scale?: number };
}): Placement;
export async function resolvePhotoMode(templatePng: Buffer, slot: SlotConfig, declared: string): Promise<PhotoMode>;
```

- [ ] **Step 1: Write the failing test** — the three §13 rules and §13.5's normalisation, as numbers derived from `figurePng`'s planted geometry (head 40x50 at y 40, body 80 wide to y 260, canvas 200x300):

```ts
// frontend-web/tests/unit/photo-jobs/blend/placement.test.ts
import { describe, expect, it } from 'vitest';
import type { SlotConfig } from '@/src/lib/rendering/imageCompositor';
import { planPlacement, resolvePhotoMode } from '@/src/lib/rendering/blend/placement';
import { resolveBlendParams } from '@/src/lib/rendering/blend/params';
import { measureSubject } from '@/src/lib/rendering/blend/subject-metrics';
import { figurePng, holedTemplate, opaqueTemplate } from './fixtures';

const natural = resolveBlendParams('natural');   // subjectFill 0.94
const CANVAS = { width: 1000, height: 1000 };
const slot = (o: Partial<SlotConfig> = {}): SlotConfig => ({
  id: 's1', slot_name: 'contestant', slot_type: 'contestant', slot_order: 0,
  x: 100, y: 100, width: 400, height: 400, rotation: 0, z_index: 1, scale: 1,
  crop_mode: 'cover', border_radius: 0, opacity: 1, ...o,
});
const of = async (o: Parameters<typeof figurePng>[0] = {}) => measureSubject(await figurePng(o));

describe('planPlacement', () => {
  it('Mode A preserves the subject aspect and puts the feet on the slot bottom', async () => {
    const p = planPlacement({ mode: 'background', slot: slot(), metrics: await of(), params: natural, canvas: CANVAS });
    // natural fill = 400 * 0.94 = 376 of the 220px silhouette -> scale 1.709
    expect(p.target.height).toBe(376);
    expect(p.target.width).toBe(Math.round(80 * (376 / 220)));
    expect(p.anchor).toBe('bottom');                       // silhouette reaches its bottom third
    expect(p.target.top + p.target.height).toBe(500);      // slot bottom = the shared ground line
    expect(p.source).toEqual({ x: 60, y: 40, width: 80, height: 220 });  // nothing cropped
  });

  it('caps by width so a wide silhouette is never cut', async () => {
    // head 40 wide, body 900 wide inside a 1000x1000 subject on a 400x400 slot
    const m = await of({ w: 1000, h: 1000, headTop: 100, headWidth: 40, headHeight: 50, bodyWidth: 900, bodyBottom: 900 });
    const p = planPlacement({ mode: 'background', slot: slot(), metrics: m, params: natural, canvas: CANVAS });
    expect(p.target.width).toBeLessThanOrEqual(400);
    expect(p.target.height).toBeLessThan(376);             // width became the binding cap
  });

  it('normalises framing: the head, not the crop, sets the scale (§13.5)', async () => {
    const tight = planPlacement({ mode: 'background', slot: slot(), canvas: CANVAS, params: natural,
      metrics: await of({ h: 300, headTop: 20, headWidth: 40, headHeight: 50, bodyWidth: 120, bodyBottom: 120 }) });
    const loose = planPlacement({ mode: 'background', slot: slot(), canvas: CANVAS, params: natural,
      metrics: await of({ h: 300, headTop: 20, headWidth: 40, headHeight: 50, bodyWidth: 120, bodyBottom: 170 }) });
    // Same 50px head in both, different silhouette extent (100 vs 150) and both fit.
    expect(tight.target.height).toBeCloseTo(100 * (112.8 / 50), 0);
    expect(loose.target.height).toBeCloseTo(150 * (112.8 / 50), 0);
    expect(tight.scale).toBeCloseTo(loose.scale, 6);       // one head size -> one scale
  });

  it('Mode B fills the window, keeps the head inside it and clips the overflow', async () => {
    const p = planPlacement({ mode: 'photo_area', slot: slot(), metrics: await of(), params: natural, canvas: CANVAS });
    expect(p.target).toEqual({ left: 100, top: 100, width: 400, height: 400 });  // the window
    expect(p.clip).toEqual({ left: 100, top: 100, width: 400, height: 400 });
    // cover of an 80x220 silhouette by a 400x400 window -> scale 5 -> the window
    // shows 80 subject px wide and 80 tall, so the rest of the body is clipped.
    expect(p.source.width).toBe(80);
    expect(p.source.height).toBe(80);
    expect(p.source.y).toBeLessThanOrEqual(40);            // headTop still inside, §13.3
    expect(p.faceOnCanvas.y).toBeGreaterThanOrEqual(124 - 6);   // headroom 0.06 * h
    expect(p.faceOnCanvas.y + p.faceOnCanvas.height).toBeLessThanOrEqual(500);
  });

  it('bleed enlarges the placement box and leaves the clip as the window', async () => {
    const p = planPlacement({ mode: 'photo_area', slot: slot({ bleed: true }), metrics: await of(), params: natural, canvas: CANVAS });
    expect(p.clip).toEqual({ left: 100, top: 100, width: 400, height: 400 });
    expect(p.target).toEqual({ left: 70, top: 70, width: 460, height: 460 });    // 15 % centred pad
    expect(p.source.width).toBe(Math.round(460 / 5.75));   // cover now resolves against the bleed box
  });

  it('applies editor offsets last and on top of the plan', async () => {
    const m = await of();
    const args = { mode: 'background' as const, slot: slot(), metrics: m, params: natural, canvas: CANVAS };
    const base = planPlacement(args);
    const moved = planPlacement({ ...args, overrides: { yOffset: -20, scale: 1.1 } });
    expect(moved.target.top).toBe(base.target.top - 20);
    expect(moved.target.height).toBe(Math.round(base.target.height * 1.1));
  });

  it('reads the template when the mode is auto and obeys it when declared', async () => {
    expect(await resolvePhotoMode(await opaqueTemplate(400), slot(), 'auto')).toBe('background');
    expect(await resolvePhotoMode(await holedTemplate(400, { x: 100, y: 100, width: 400, height: 400 }), slot(), 'auto')).toBe('photo_area');
    expect(await resolvePhotoMode(await opaqueTemplate(400), slot(), 'photo_area')).toBe('photo_area');
    expect(await resolvePhotoMode(await opaqueTemplate(400), slot(), 'nonsense')).toBe('background'); // falls back, never throws
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/photo-jobs/blend/placement.test.ts` → module not found.
- [ ] **Step 3: Implement `planPlacement`** exactly as spec §13 steps 1–6, with the two constants §13.5 and §13.3 require named at module top:

```ts
/** §13.5: a reference portrait shows a head that is 30 % of the visible silhouette. */
export const CANONICAL_HEAD_SHARE = 0.30;
/** §13.3: how far past the window a `bleed` slot reaches, as a fraction of the window. */
export const BLEED_PAD = 0.15;
```

Mode A's scale is `min(headTargetPx / headHeightPx, boxFillPx / silhouetteHeight, boxWidth / bbox.width)` with `headTargetPx = boxFillPx * CANONICAL_HEAD_SHARE` — head-normalised, then box-capped, which is what makes §13.5's two framings agree without ever letting a silhouette spill past the slot. Mode B's scale is `max(placementWidth / bbox.width, placementHeight / bbox.height)` (cover), the source crop is the window's worth of subject pixels, positioned so `headTop` lands `0.06 × h` below the window top and the face box is horizontally centred; when the silhouette is shorter than the window at that scale, anchor on the face box rather than the bbox centre (§13.3). Anchor resolution: `bottom` puts `bbox.y + bbox.height` on the slot bottom, `centre` centres, `top` puts `headTop` at `0.06 × h` from the top, and `auto` is `bottom` when `metrics.bottomY` reaches the bottom third of the subject canvas and `centre` otherwise; `slot.anchor` overrides. `clip` is set in Mode B only — the window, never the bleed box.

Then `resolvePhotoMode`: extract the slot rect from the template with `sharp(...).extract(rect).ensureAlpha().extractChannel(3).raw()`, count `>= 128` vs `< 128`, and return `photo_area` when at least half the region is transparent; `background` for `'auto'` on a solid region, and any explicit `'background'`/`'photo_area'` verbatim. A declared value outside those three (a hand-edited row) returns `'background'` with a `console.warn` — the legacy paste is the safe answer, not an exception.
- [ ] **Step 4: Run to verify it passes** — 7 passing.
- [ ] **Step 5: Commit** `git add …/placement.ts …/placement.test.ts && git commit -m "feat(photo): place the subject by what the matte says about it"`

---

### Task 5: Edge refinement (§6 A)

**Files:**
- Create: `frontend-web/src/lib/rendering/blend/edge-refine.ts`
- Test: `frontend-web/tests/unit/photo-jobs/blend/edge-refine.test.ts`

**Interfaces:**
- Consumes: cutout PNG bytes + `BlendParams` + the slot dimensions (the feather cap in §5.3 is a fraction of the **slot**, so the caller must supply them).
- Produces:

```ts
export interface EdgeApplied { fringePixels: number; droppedComponents: number; closedHoles: number; featherPx: number }
export async function refineEdges(
  png: Buffer,
  params: BlendParams,
  slot: { width: number; height: number },
): Promise<{ png: Buffer; applied: EdgeApplied }>;
```

- [ ] **Step 1: Write the failing test** — planted defects, measured outcomes:

```ts
// frontend-web/tests/unit/photo-jobs/blend/edge-refine.test.ts
import { describe, expect, it } from 'vitest';
import { refineEdges } from '@/src/lib/rendering/blend/edge-refine';
import { resolveBlendParams } from '@/src/lib/rendering/blend/params';
import { alphaAt, pixelAt, rgbaPng } from './fixtures';

const natural = resolveBlendParams('natural');   // featherPx 1, speckleMinArea 24, holeMaxArea 24
const bold = resolveBlendParams('bold');         // featherPx 2, speckleMinArea 6, holeMaxArea 60

/** A magenta disc on a green field, with a half-and-half fringe ring at alpha 128. */
const fringeCutout = () => rgbaPng(60, 60, (x, y) => {
  const d = Math.hypot(x - 30, y - 30);
  if (d < 18) return { r: 255, g: 0, b: 255, a: 255 };
  if (d < 19) return { r: 128, g: 255, b: 128, a: 128 };   // 0.5 magenta + 0.5 green
  return { r: 0, g: 255, b: 0, a: 0 };
});
/** A 30x30 opaque patch that carries either a 2x2 speckle or a 1px hole. */
const patch = (defect: 'speckle' | 'hole') => rgbaPng(60, 60, (x, y) => {
  if (defect === 'speckle' && x >= 50 && x < 52 && y >= 50 && y < 52) return { r: 9, g: 9, b: 9, a: 255 };
  const inPatch = x >= 10 && x < 40 && y >= 10 && y < 40;
  if (defect === 'hole' && x === 20 && y === 20) return { r: 0, g: 0, b: 0, a: 0 };
  return inPatch ? { r: 200, g: 160, b: 130, a: 255 } : { r: 0, g: 0, b: 0, a: 0 };
});
const opaqueArea = (png: Buffer) => countAlpha(png, (a) => a >= 200);

it('removes the residual background colour from the fringe without touching the core', async () => {
  const { png, applied } = await refineEdges(await fringeCutout(), natural, { width: 300, height: 400 });
  expect(applied.fringePixels).toBeGreaterThan(0);
  expect((await pixelAt(png, 30, 30)).rgb).toEqual([255, 0, 255]);          // core untouched
  const ring = (await pixelAt(png, 48, 30)).rgb;                             // d ~= 18.0x -> ring
  expect(ring[1] - (ring[0] + ring[2]) / 2).toBeLessThan(32);                // was 127.5 of green
});

it('drops a stray speckle and keeps a real detail', async () => {
  const { png, applied } = await refineEdges(await patch('speckle'), natural, { width: 300, height: 400 });
  expect(applied.droppedComponents).toBe(1);
  expect(await opaqueArea(png)).toBe(900);                                   // exactly the 30x30 patch
});

it('closes a hole inside the body', async () => {
  const { png, applied } = await refineEdges(await patch('hole'), natural, { width: 300, height: 400 });
  expect(applied.closedHoles).toBe(1);
  expect(await alphaAt(png, 20, 20)).toBeGreaterThanOrEqual(200);
});

it('never feathers past the cap, and never softens the interior', async () => {
  // §5.3: cap = floor(min(slotW, slotH) * 0.004). A 300px slot caps at 1, so bold's
  // 2 is pulled down; a 60px slot caps at 0, so nothing is blurred at all.
  const wide = await refineEdges(await fringeCutout(), bold, { width: 300, height: 400 });
  expect(wide.applied.featherPx).toBe(1);
  const narrow = await refineEdges(await fringeCutout(), bold, { width: 60, height: 80 });
  expect(narrow.applied.featherPx).toBe(0);
  expect(await alphaAt(wide.png, 30, 30)).toBe(255);                         // interior stays hard
});
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** the three passes of spec §5.1–§5.3 over the raw RGBA array. The defringe is the exact unmix in §5.1 (`bg` = channel-wise median over `alpha < 32` inside a ring 12 % of the bbox's smaller side around the bbox, falling back to no defringe when fewer than 64 such pixels exist — a cutout with no residual background must not be "fixed"). Connected components are an iterative-stack flood fill over `alpha >= 8`; drop components smaller than `speckleMinArea` that are not the largest; close holes that are fully enclosed, smaller than `holeMaxArea`, and not touching the bbox edge. The feather is a separable box blur on band 3 only with `radius = clamp(params.featherPx, 0, floor(min(slot.width, slot.height) * 0.004))`, taken from the `slot` argument. Blur band 3 and rejoin it over the original RGB — do not blur the whole image, and do not read alpha back off an encoded buffer (spec §2, trap 1).
- [ ] **Step 4: Run to verify it passes** — 4 passing.
- [ ] **Step 5: Commit** `git commit -m "feat(photo): defringe, despeckle and cap the feather of the cutout"`

---

### Task 6: Colour and lighting match (§6 B)

**Files:**
- Create: `frontend-web/src/lib/rendering/blend/light-match.ts`
- Test: `frontend-web/tests/unit/photo-jobs/blend/light-match.test.ts`

**Interfaces:**
- Consumes: refined subject PNG, template PNG, placement target rect + mode, `BlendParams`.
- Produces:

```ts
export interface RegionStats { meanLuma: number; meanR: number; meanG: number; meanB: number; pixels: number }
export interface AppliedLight { subjectLuma: number; refLuma: number; gain: number; temperature: { r: number; b: number }; contrast: number; clamped: string[] }
export async function measureRegion(png: Buffer, rect: Rect): Promise<RegionStats | null>;
export async function measureSubjectLight(png: Buffer): Promise<RegionStats>;   // opaque pixels only
export async function matchLight(subject: Buffer, subjectStats: RegionStats,
  ref: RegionStats | null, params: BlendParams): Promise<{ png: Buffer; applied: AppliedLight }>;
```

`referenceStats` is not a parameter here on purpose: Task 9 computes it with `measureRegion(templatePng, dilated(placement.target))` and passes the value in, so the template is decoded once per job instead of once per stage.

- [ ] **Step 1: Write the failing test** — this is where §6.B's "not identical filters" gets proved:

```ts
// frontend-web/tests/unit/photo-jobs/blend/light-match.test.ts
import { describe, expect, it } from 'vitest';
import { matchLight, measureRegion, measureSubjectLight } from '@/src/lib/rendering/blend/light-match';
import { resolveBlendParams } from '@/src/lib/rendering/blend/params';
import { countAlpha, flatPng, rgbaPng } from '@/tests/unit/photo-jobs/blend/fixtures';

const natural = resolveBlendParams('natural');  // lumaFraction .45 lumaBias .97 gain .92-1.08 tempMax .04
const grey = (l: number) => flatPng(100, 100, { r: l, g: l, b: l, a: 255 });
const meanLuma = async (png: Buffer) => {
  const { data } = await flatRaw(png);
  let s = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) { s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++; }
  return s / n;
};

it('moves the subject part of the way toward the reference, by its own amount', async () => {
  const ref = { meanLuma: 140, meanR: 150, meanG: 145, meanB: 140, pixels: 5000 };
  const subject = await grey(135);
  const a = await matchLight(subject, await measureSubjectLight(subject), ref, natural);
  // gain = 140*0.97/135 = 1.037 (inside natural's +-8 %), applied at 45 % -> 135 * 1.0166
  expect(a.applied.gain).toBeCloseTo(140 * 0.97 / 135, 3);
  expect(a.applied.clamped).toEqual([]);
  expect(await meanLuma(a.png)).toBeCloseTo(135 * (1 + 0.45 * (a.applied.gain - 1)), 0);
  expect(a.png).not.toBe(subject);                                          // a new image, not the input
});

it('gives a second subject a different number for the same frame', async () => {
  const ref = { meanLuma: 140, meanR: 150, meanG: 145, meanB: 140, pixels: 5000 };
  const dark = await grey(100);
  const b = await matchLight(dark, await measureSubjectLight(dark), ref, natural);
  expect(b.applied.gain).toBe(1.08);                     // 1.358 wanted, gainMax bound
  expect(b.applied.clamped).toContain('gain');
  expect(await meanLuma(b.png)).toBeCloseTo(100 * (1 + 0.45 * 0.08), 0);   // 103.6, not 135.8
});

it('tilts R and B toward the frame without rotating hue past tempMax', async () => {
  const warm = await rgbaPng(100, 100, () => ({ r: 200, g: 150, b: 100, a: 255 }));
  const coolRef = { meanLuma: 140, meanR: 120, meanG: 145, meanB: 180, pixels: 5000 };
  const { png, applied } = await matchLight(warm, await measureSubjectLight(warm), coolRef, natural);
  expect(applied.temperature.r).toBeLessThan(1);         // warmer subject pulled cooler
  expect(applied.temperature.b).toBeGreaterThan(1);
  expect(Math.abs(applied.temperature.r - 1)).toBeLessThanOrEqual(0.04);   // §12 tempMax
  expect(Math.abs(applied.temperature.b - 1)).toBeLessThanOrEqual(0.04);
  const ch = await meanChannels(png);
  expect(ch.r).toBeLessThan(200); expect(ch.b).toBeGreaterThan(100);
  expect(Math.abs(Math.atan2(1.732 * (ch.g - ch.b), 2 * ch.r - ch.g - ch.b)
    - Math.atan2(1.732 * (150 - 100), 2 * 200 - 150 - 100)) * 57.3).toBeLessThan(3); // §6.3 guard
});

it('does nothing when there is no reference region', async () => {
  const subject = await grey(135);
  const r = await matchLight(subject, await measureSubjectLight(subject), null, natural);
  expect(r.applied.gain).toBe(1);
  expect(await meanLuma(r.png)).toBeCloseTo(135, 0);     // pixels unchanged
});

it('measures only the pixels it is pointed at, and only opaque ones', async () => {
  const png = await rgbaPng(100, 100, (x, y) => (x < 50 ? { r: 255, g: 0, b: 0, a: 255 } : { r: 0, g: 0, b: 0, a: 0 }));
  const left = await measureRegion(png, { x: 0, y: 0, width: 50, height: 100 });
  expect(left).toMatchObject({ meanR: 255, meanG: 0, meanB: 0, pixels: 5000 });
  expect(await measureRegion(png, { x: 50, y: 0, width: 50, height: 100 })).toBeNull();  // all transparent
  expect(await countAlpha(png, (a) => a === 0)).toBe(5000);
});
```

`flatRaw` and `meanChannels` are two six-line helpers in the same test file: `flatRaw` is `sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })`, and `meanChannels` averages bands 0-2 over opaque pixels. They exist so the luma convention in §6.1 is asserted by the test's own arithmetic instead of by whatever the implementation happens to call luma.

- [ ] **Step 2: Run to verify it fails** — module not found.
- [ ] **Step 3: Implement** per spec §6.1–§6.4, with the arithmetic pinned so no stage improvises:
  - `luma(r,g,b) = 0.2126r + 0.7152g + 0.0722b` on the sRGB codes — one convention, stated once, asserted by the helper arithmetic above.
  - `measureSubjectLight(png)` stats over pixels with `alpha >= 200` only; `measureRegion(png, rect)` returns `null` when fewer than 64 opaque pixels fall in `rect`, which is how "no reference to match" is detected rather than guessed.
  - The reference region is the placement rect dilated by 25 % minus the rect itself (§6.2), so the subject is matched to what surrounds it, never to its own pixels.
  - `gain = clamp(lumaBias * ref.meanLuma / subject.meanLuma, gainMin, gainMax)`; `k = 1 + lumaFraction * (gain - 1)`; every RGB channel is multiplied by `k`. Reporting `applied.gain` as the *clamped target* and `k` as what was applied is what lets §14.5 distinguish "matched by 8 %" from "matched by 45 % of 8 %".
  - `deltaR = clamp((ref.meanR / ref.meanB) / (subject.meanR / subject.meanB) - 1, -tempMax, tempMax)`; channel R is then multiplied by `1 + lumaFraction * deltaR` and B by `1 + lumaFraction * -deltaR`. G is never touched, which is why §6.3's skin-tone guard holds by construction and not by tuning. `applied.temperature` reports `{ r, b }` as the factors actually used, so `r < 1` and `b > 1` together mean "this subject was too warm for its frame".
  - `contrast` (§6.3's third term) is a `linear` on RGB with slope `1 + lumaFraction * clamp((refSpread / subjectSpread) - 1, -contrastMax, contrastMax)`, where spread is the mean absolute deviation of luma; `contrast: 0` in the `off` preset makes it a no-op.
  - Alpha is copied from the original array and rejoined, never scaled — that is what keeps the matte's identity through the light stage (and it is why §2's trap-2 channel promotion has to be defended against here too).
- [ ] **Step 4: Run to verify it passes** — 5 passing.
- [ ] **Step 5: Commit** `git add …/light-match.ts …/light-match.test.ts && git commit -m "feat(photo): match light to the frame it is standing in"`

---

### Task 7: Shadows and face-safe layering (§6 C, §6 D)

**Files:**
- Create: `frontend-web/src/lib/rendering/blend/shadow.ts`
- Create: `frontend-web/src/lib/rendering/blend/face-safe.ts`
- Test: `frontend-web/tests/unit/photo-jobs/blend/shadow.test.ts`, `…/face-safe.test.ts`

**Interfaces:**
- Consumes: refined subject PNG, the `Placement` from Task 4, `BlendParams`.
- Produces:

```ts
export interface Underlay { buffer: Buffer; left: number; top: number }   // absolute canvas coords
export async function buildShadowLayers(
  subject: Buffer, placement: Placement, metrics: SubjectMetrics, params: BlendParams,
): Promise<Underlay[]>;
export async function protectFace(overlay: Buffer, o: { rect: Rect; face: Rect; strength: number }): Promise<Buffer>;
```

`buildShadowLayers` returns `[]` when `params.shadow === 'off'`, when `dropOpacity` and `contactOpacity` are both 0 (the `off` preset), or when the placement carries a `clip` — §7's rule that a figure inside a window is grounded by the window's own art, not by our shadow. Each buffer is `target.width + 2*pad` by `target.height + 2*pad + shadowOffsetPx` with `pad = ceil(2 * shadowBlurPx)`, and its `left`/`top` are `placement.target.left - pad` / `placement.target.top - pad + shadowOffsetPx`, so the compositor draws it with no further arithmetic. The contact band is centred on the feet: canvas rows `bboxBottomCanvas - contactHeight .. bboxBottomCanvas + 2`, where `contactHeight = max(4, round(0.04 * target.height))` and `bboxBottomCanvas = placement.target.top + (metrics.bottomY - placement.source.y) * (target.height / source.height)`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend-web/tests/unit/photo-jobs/blend/shadow.test.ts
import { describe, expect, it } from 'vitest';
import { buildShadowLayers } from '@/src/lib/rendering/blend/shadow';
import { resolveBlendParams } from '@/src/lib/rendering/blend/params';
import { measureSubject } from '@/src/lib/rendering/blend/subject-metrics';
import { alphaAt, countAlpha, rgbaPng } from './fixtures';
import type { Placement } from '@/src/lib/rendering/blend/placement';

// A 40px opaque disc centred in a 100x100 subject (rows 31..68 are inside it).
const disc = () => rgbaPng(100, 100, (x, y) => (Math.hypot(x - 50, y - 50) < 20
  ? { r: 200, g: 160, b: 130, a: 255 } : { r: 0, g: 0, b: 0, a: 0 }));
// A 1:1 mapping, so subject px and canvas px differ only by the +100 offset.
const placement: Placement = { source: { x: 0, y: 0, width: 100, height: 100 },
  target: { left: 100, top: 100, width: 100, height: 100 },
  faceOnCanvas: { x: 130, y: 115, width: 25, height: 31 }, anchor: 'centre', mode: 'background', scale: 1 };
const natural = resolveBlendParams('natural');   // dropOpacity .10 blur 12 offset 10 contact .12

it('draws nothing where the subject is, so it cannot read as an outline or a glow', async () => {
  const subject = await disc();
  const m = await measureSubject(subject);
  const layers = await buildShadowLayers(subject, placement, m, natural);
  for (const l of layers) {
    expect(await alphaAt(l.buffer, 150 - l.left, 150 - l.top)).toBe(0);   // disc core
    expect(await alphaAt(l.buffer, 140 - l.left, 140 - l.top)).toBe(0);   // and nearer its edge
  }
});

it('grounds the figure: a drop layer below it and a contact layer at its feet', async () => {
  const subject = await disc();
  const m = await measureSubject(subject);
  const [drop, contact] = await buildShadowLayers(subject, placement, m, natural);
  expect(await countAlpha(drop.buffer, (a) => a > 0)).toBeGreaterThan(200);
  expect(drop.left).toBe(100 - Math.ceil(2 * 12));                 // pad, so the blur is not clipped
  expect(drop.top).toBe(100 - Math.ceil(2 * 12) + 10);             // §12 shadowOffsetPx, downward
  expect(await alphaAt(drop.buffer, 150 - drop.left, 176 - drop.top)).toBeGreaterThan(0); // below the feet
  expect(await countAlpha(drop.buffer, (a) => a > Math.round(0.10 * 255) + 1)).toBe(0);   // never above dropOpacity
  expect(await countAlpha(contact.buffer, (a) => a > 0)).toBeGreaterThan(50);              // a band exists
  expect(await countAlpha(contact.buffer, (a) => a > Math.round(0.12 * 255) + 1)).toBe(0);
  // §7 contact band = [bboxBottom − contactHeight, bboxBottom + 2] = rows 164..170 (bboxBottom 168, height 4)
  expect(await alphaAt(contact.buffer, 150 - contact.left, 170 - contact.top)).toBeGreaterThan(0); // just past the feet
  expect(await alphaAt(contact.buffer, 150 - contact.left, 166 - contact.top)).toBe(0);            // inside the disc: masked
  expect(await alphaAt(contact.buffer, 150 - contact.left, 130 - contact.top)).toBe(0);            // nowhere above the feet
});

it('is absent for a clipped window and for the off preset', async () => {
  const subject = await disc();
  const m = await measureSubject(subject);
  const clipped = { ...placement, clip: { left: 100, top: 100, width: 100, height: 100 } };
  expect(await buildShadowLayers(subject, clipped, m, natural)).toEqual([]);
  expect(await buildShadowLayers(subject, placement, m, resolveBlendParams('off'))).toEqual([]);
});
```

```ts
// frontend-web/tests/unit/photo-jobs/blend/face-safe.test.ts
import { describe, expect, it } from 'vitest';
import { protectFace } from '@/src/lib/rendering/blend/face-safe';
import { alphaAt, flatPng } from './fixtures';

const face = { x: 100, y: 100, width: 60, height: 80 };
const rect = { x: 0, y: 0, width: 300, height: 300 };

it('lets a banner cross the body but not the face', async () => {
  const out = await protectFace(await flatPng(300, 300, { r: 0, g: 255, b: 0, a: 255 }), { rect, face, strength: 0.92 });
  const centre = await alphaAt(out, 130, 140);
  const hairline = await alphaAt(out, 130, 112);
  expect(centre).toBeLessThanOrEqual(Math.round(255 * (1 - 0.92)) + 1);  // face centre: strongest removal
  expect(hairline).toBeGreaterThan(centre);                              // §8.2 falloff is monotone from the centre
  expect(await alphaAt(out, 130, 200)).toBe(255);   // 20 px past the face: feather band restores it
  expect(await alphaAt(out, 10, 10)).toBe(255);     // far outside: untouched
});

it('is a straight copy when the layer does not reach the face', async () => {
  const layer = await flatPng(50, 50, { r: 0, g: 255, b: 0, a: 255 });
  const away = { x: 1000, y: 1000, width: 60, height: 80 };
  const out = await protectFace(layer, { rect: { x: 0, y: 0, width: 50, height: 50 }, face: away, strength: 0.92 });
  const again = await protectFace(layer, { rect: { x: 0, y: 0, width: 50, height: 50 }, face: { x: 900, y: 900, width: 10, height: 10 }, strength: 0.92 });
  expect(await alphaAt(out, 25, 25)).toBe(255);
  expect(out.equals(again)).toBe(true);
});
```

Note the geometry in the second test: a face box entirely outside the layer's rect means the falloff evaluates to 0 everywhere, so the buffers must come back equal — that is the no-op proof, asserted on bytes rather than on a byte length that any PNG would satisfy.

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** spec §7 (drop: blur σ from `shadowBlurPx` on band 3, scale 1.02, offset `(0, shadowOffsetPx)`, black tint, `dropOpacity`; contact: flatten the alpha into `contactHeight = max(4, 0.04 × target.height)` rows at the silhouette bottom, stronger `contactOpacity`; both multiplied by `1 − alphaSubject`) and §8.2 (radial falloff across `face`, feathered over the outer 20 %, `alpha ×= 1 − strength × falloff`).
- [ ] **Step 4: Run to verify they pass** — 5 passing.
- [ ] **Step 5: Commit** `git commit -m "feat(photo): ground the subject and keep its face clear"`

---

### Task 8: Compositor: caller bytes, explicit placement, underlays, face-safe, chosen encode

**Files:**
- Modify: `frontend-web/src/lib/rendering/imageCompositor.ts`
- Test: `frontend-web/tests/unit/rendering/compositor-blend.test.ts`

**Interfaces:**
- Consumes: `Placement`, shadow layers, foreground `SlotConfig`s with `image_url`, `photo_bytes`.
- Produces (additive to the existing exports):

```ts
export interface SlotConfig { /* …existing keys… */
  image_url?: string | null; photo_bytes?: Buffer | null;
  placement?: Placement; face_protect?: boolean; bleed?: boolean; anchor?: string; }
export interface CompositorInput { /* …existing keys… */
  templateUrl?: string;                 // required unless templateBytes is present
  templateBytes?: Buffer | null;
  underlays?: { buffer: Buffer; left: number; top: number }[];
  faceSafe?: { face: Rect; strength: number } | null; }
export async function chooseEncode(image: Buffer, jpegQuality: number): Promise<{ buffer: Buffer; mimeType: string }>;
```

`chooseEncode` is exported because spec §9's rule is worth testing on its own; `compositeImage` calls it instead of `.png()` and takes the quality from `blendSettings.jpegQuality` (90 when absent).

Behaviour rules to honour: absent `placement` ⇒ today's geometry path exactly; absent `blend`-shaped fields ⇒ today's output; a slot with `placement.source` is cropped *before* resize; `placement.clip` clips after rotation (Mode B containment); `underlays` render between the template and the first slot; `faceSafe` is applied to a slot's rendered overlay only when that slot's `face_protect !== false` and its `z_index` is greater than the contestant slot's; the encode is spec §9's smaller-of with the transparency veto.

- [ ] **Step 1: Write the failing test** — the legacy path first, because it is what makes the rest safe to ship:

```ts
// frontend-web/tests/unit/rendering/compositor-blend.test.ts
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { compositeImage } from '@/src/lib/rendering/imageCompositor';
import { flatPng, holedTemplate, opaqueTemplate, pixelAt, rgbaPng } from '@/tests/unit/photo-jobs/blend/fixtures';

const baseSlot = { id: 's1', slot_name: 'c', slot_type: 'contestant', slot_order: 0,
  x: 100, y: 100, width: 200, height: 200, rotation: 0, z_index: 1, scale: 1,
  crop_mode: 'cover', border_radius: 0, opacity: 1 } as const;

it('is a straight-line read when no caller passes the new fields', async () => {
  // The behaviour P1 ships today: the slot rect comes from x/y/width/height*scale,
  // the source is fetched by URL, and the result is a PNG of the template size.
  // Byte-for-byte equality with P1 is proved outside vitest, in Task 11 Step 2,
  // where two worktrees can render the same input and be hashed.
  const template = await opaqueTemplate(400);
  const r = await compositeImage({ templateUrl: 'https://redcdn.example/t.png', templateBytes: template,
    templateWidth: 400, templateHeight: 400, slots: [{ ...baseSlot, photo_bytes: await flatPng(20, 20, { r: 255, g: 0, b: 0, a: 255 }) }] });
  const md = await sharp(r.buffer).metadata();
  expect(md).toMatchObject({ width: 400, height: 400, format: 'png' });
  expect((await pixelAt(r.buffer, 10, 10)).rgb).toEqual([20, 40, 80]);   // template shows outside slots
});

it('crops from source space then resizes to the target box', async () => {
  const subject = await rgbaPng(100, 100, (x, y) => ({ r: x < 50 ? 0 : 255, g: y < 50 ? 0 : 255, b: 0, a: 255 }));
  const r = await compositeImage({ templateUrl: 'https://redcdn.example/t.png', templateBytes: await opaqueTemplate(400),
    templateWidth: 400, templateHeight: 400, slots: [{ ...baseSlot, photo_bytes: subject,
      placement: { source: { x: 50, y: 50, width: 50, height: 50 },
        target: { left: 100, top: 100, width: 200, height: 200 }, faceOnCanvas: { x: 0, y: 0, width: 0, height: 0 },
        anchor: 'bottom', mode: 'background', scale: 4 } }] });
  expect((await pixelAt(r.buffer, 105, 105)).rgb).toEqual([255, 255, 0]); // the bottom-right quadrant only
  expect((await pixelAt(r.buffer, 295, 295)).rgb).toEqual([255, 255, 0]);
});

it('clips to the window a placement provides', async () => {
  const big = await flatPng(600, 600, { r: 255, g: 255, b: 255, a: 255 });
  const r = await compositeImage({ templateUrl: 'https://redcdn.example/t.png', templateBytes: await opaqueTemplate(1000),
    templateWidth: 1000, templateHeight: 1000, slots: [{ ...baseSlot, photo_bytes: big,
      placement: { source: { x: 0, y: 0, width: 600, height: 600 },
        target: { left: -100, top: -100, width: 800, height: 800 },
        clip: { left: 100, top: 100, width: 200, height: 200 },
        faceOnCanvas: { x: 0, y: 0, width: 0, height: 0 }, anchor: 'centre', mode: 'photo_area', scale: 1 } }] });
  expect((await pixelAt(r.buffer, 150, 150)).rgb).toEqual([255, 255, 255]);  // inside the window
  expect((await pixelAt(r.buffer, 50, 50)).rgb).toEqual([20, 40, 80]);       // outside it: the template
});

it('draws underlays below every slot', async () => {
  const r = await compositeImage({ templateUrl: 'https://redcdn.example/t.png', templateBytes: await opaqueTemplate(400),
    templateWidth: 400, templateHeight: 400,
    underlays: [{ buffer: await flatPng(20, 20, { r: 0, g: 0, b: 0, a: 255 }), left: 10, top: 10 }],
    slots: [{ ...baseSlot, photo_bytes: await flatPng(200, 200, { r: 9, g: 9, b: 9, a: 0 }) }] });
  expect((await pixelAt(r.buffer, 12, 12)).rgb).toEqual([0, 0, 0]);
});

it('protects the face on a foreground slot and not on the subject slot', async () => {
  const face = { x: 150, y: 150, width: 60, height: 60 };
  const r = await compositeImage({ templateUrl: 'https://redcdn.example/t.png', templateBytes: await opaqueTemplate(400),
    templateWidth: 400, templateHeight: 400, faceSafe: { face, strength: 0.92 },
    slots: [ { ...baseSlot, photo_bytes: await flatPng(200, 200, { r: 255, g: 0, b: 0, a: 255 }) },
             { ...baseSlot, id: 's2', slot_type: 'badge', z_index: 5, face_protect: true,
               photo_bytes: await flatPng(200, 200, { r: 0, g: 255, b: 0, a: 255 }) } ] });
  const over = (await pixelAt(r.buffer, 180, 180)).rgb;                      // badge over the face
  expect(over[0]).toBeGreaterThan(200); expect(over[1]).toBeLessThan(60);    // the face survives
  expect((await pixelAt(r.buffer, 110, 110)).rgb).toEqual([0, 255, 0]);      // elsewhere it is a badge
});

it('picks the smaller encode, keeps PNG on a tie, and vetoes JPEG under transparency', async () => {
  // §14.10 asserts the rule through chooseEncode rather than a hard-coded byte
  // count: the sizes depend on the encoder's own settings, and a test that
  // re-implements them is a second source of truth that drifts.
  const photo = await rgbaPng(200, 200, (x, y) => ({ r: (x * 7 + y * 13) % 256, g: (x * 11 + y * 3) % 256, b: (x * 5 + y * 17) % 256, a: 255 }));
  expect((await chooseEncode(photo, 90)).mimeType).toBe('image/jpeg');       // photographic content
  expect((await chooseEncode(await opaqueTemplate(200), 90)).mimeType).toBe('image/png');  // flat: png wins
  expect((await chooseEncode(await holedTemplate(200, { x: 20, y: 20, width: 60, height: 60 }), 90)).mimeType).toBe('image/png'); // §9 veto
  const soft = await chooseEncode(photo, 85); const sharpJpg = await chooseEncode(photo, 95);
  expect(sharpJpg.buffer.byteLength).toBeGreaterThan(soft.buffer.byteLength); // preset quality reaches the encoder
});
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** in `imageCompositor.ts`. The `blend` fields are read inside `processSlot` only when present, so the existing path stays a straight-line read. Add `async function chooseEncode(overlays): Promise<{buffer, mimeType}>` implementing §9. Keep `fetchImageBuffer` for URL sources and route bytes around it — no fetch when `photo_bytes`/`templateBytes` exist, because the runner has already paid for those reads and a second fetch of a signed URL can fail on expiry.
- [ ] **Step 4: Run to verify it passes** — 6 passing; then `npx vitest run tests/unit/rendering tests/unit/photo-jobs` with no regressions.
- [ ] **Step 5: Commit** `git commit -m "feat(render): let the compositor take pixels, placement, underlays and a face-safe clip"`

---

### Task 9: The blend orchestrator

**Files:**
- Create: `frontend-web/src/lib/rendering/blend/index.ts`
- Test: `frontend-web/tests/unit/photo-jobs/blend/engine.test.ts`

**Interfaces:**
- Consumes: Tasks 2–7.
- Produces:

```ts
export interface BlendRequest {
  subjectPng: Buffer; templatePng: Buffer; canvas: CanvasSize; slot: SlotConfig;
  metrics?: SubjectMetrics; params: BlendParams;
  overrides?: { xOffset?: number; yOffset?: number; scale?: number };
}
export interface BlendOutput {
  subjectPng: Buffer;
  placement: Placement;
  underlays: { buffer: Buffer; left: number; top: number }[];
  faceSafe: { face: Rect; strength: number } | null;
  decisions: Record<string, unknown>;   // what lands in render_params.blend
}
export async function blendSubject(req: BlendRequest): Promise<BlendOutput>;
```

`canvas` is in the request rather than decoded from `templatePng` inside the engine because the runner already has the template's dimensions from the resolver, and a second `sharp().metadata()` decode per job is a cost the caller can avoid.

- [ ] **Step 1: Write the failing test** — the pipeline order and the decision record, not the pixels:

```ts
// frontend-web/tests/unit/photo-jobs/blend/engine.test.ts
import { describe, expect, it } from 'vitest';
import { blendSubject } from '@/src/lib/rendering/blend/index';
import { resolveBlendParams } from '@/src/lib/rendering/blend/params';
import type { SlotConfig } from '@/src/lib/rendering/imageCompositor';
import { figurePng, holedTemplate, transparentPng } from './fixtures';

// A 1000px template whose window is the same 400x400 box at (100,100) that
// Tasks 4, 5 and 7 place into, so a passing engine test means every stage
// agrees on one geometry rather than on three different ones.
const slot = (o: Partial<SlotConfig> = {}): SlotConfig => ({
  id: 's1', slot_name: 'contestant', slot_type: 'contestant', slot_order: 0,
  x: 100, y: 100, width: 400, height: 400, rotation: 0, z_index: 1, scale: 1,
  crop_mode: 'cover', border_radius: 0, opacity: 1, face_protect: true, ...o,
});
const canvas = { width: 1000, height: 1000 };
const hole = { x: 100, y: 100, width: 400, height: 400 };

describe('blendSubject', () => {
  it('runs measure -> mode -> place -> refine -> match -> shadow and reports all of it', async () => {
    const subjectPng = await figurePng();
    const out = await blendSubject({ subjectPng, templatePng: await holedTemplate(1000, hole),
      canvas, slot, params: resolveBlendParams('natural') });
    expect(Object.keys(out.decisions).sort()).toEqual(
      ['applied', 'edge', 'faceProtected', 'light', 'mode', 'placement', 'preset', 'shadow']);
    expect(out.decisions.preset).toBe('natural');
    expect(out.decisions.applied).toBe(true);
    expect(out.placement.faceOnCanvas.y).toBeGreaterThan(0);
    expect(out.placement.target.top + out.placement.target.height).toBe(500); // feet on the window floor
    expect(out.underlays).toHaveLength(2);            // drop + contact for preset natural
    expect(out.faceSafe).not.toBeNull();
    expect(out.subjectPng).not.toBe(subjectPng);      // the engine returned a re-encoded cutout
  });

  it('reports a no-op for the "off" preset so the runner can use the legacy path', async () => {
    const subjectPng = await figurePng();
    const out = await blendSubject({ subjectPng, templatePng: await holedTemplate(1000, hole),
      canvas, slot, params: resolveBlendParams('off') });
    expect(out.subjectPng).toBe(subjectPng);                 // identity: same reference in, same out
    expect(out.decisions).toEqual({ preset: 'off', applied: false });
    expect(out.underlays).toEqual([]);
    expect(out.faceSafe).toBeNull();
  });

  it('survives a fully transparent subject without inventing a placement', async () => {
    const out = await blendSubject({ subjectPng: await transparentPng(200, 300),
      templatePng: await holedTemplate(1000, hole), canvas, slot, params: resolveBlendParams('natural') });
    expect(out.decisions).toMatchObject({ applied: false, reason: 'empty-subject' });
  });
});
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** the §4 sequence, returning `decisions` per spec §6.4 with `applied: true` plus the per-stage records. `empty-subject` and `no-reference-region` are the two non-throwing degenerate answers, and each names its reason in `decisions` rather than throwing, because the runner must be able to show the operator why a portrait looks paste-like.
- [ ] **Step 4: Run to verify it passes** — 3 passing.
- [ ] **Step 5: Commit** `git commit -m "feat(photo): sequence the blend stages and record what they decided"`

---

### Task 10: Runner and resolver wiring

**Files:**
- Modify: `frontend-web/src/server/photo-jobs/runner.ts`
- Modify: `frontend-web/src/server/registration/template-resolver.ts`
- Test: `frontend-web/tests/unit/photo-jobs/blend/runner-blend.test.ts` (new), `frontend-web/tests/unit/registration/template-resolver.test.ts` (extended), and `tests/unit/registration/photo-pipeline.test.ts` only where a stub shape changes

**Interfaces:**
- Consumes: `blendSubject`, `resolveBlendParams`, `resolvePhotoMode`, Task 8's compositor.
- Produces: a `final` asset whose `render_params.blend` is the decision record; a `ResolvedTemplate` that additionally carries `photoMode`, `blendPreset`, `blendSettings`, `foregroundSlots: SlotConfig[]` and the placement columns on its contestant slot.

- [ ] **Step 1: Write the failing test** — spec §14.11, four cases. This file copies the mock harness from `tests/unit/photo-jobs/runner.test.ts` verbatim (the `deps` hoisted object, the `job`, `ORIGINAL`, `slot()` and `template()` builders and the `beforeEach`) and adds two lines to it, so read that file first:

```ts
// frontend-web/tests/unit/photo-jobs/blend/runner-blend.test.ts
// Steps: copy tests/unit/photo-jobs/runner.test.ts wholesale, then make exactly
// five changes — (1) add `blendSubject: vi.fn(),` to the vi.hoisted deps object,
// (2) add the vi.mock line below, (3) replace its `template()` builder with the
// one below, (4) delete its `describe('runPhotoJob', …)` and paste this one,
// (5) add `import type { AssetLocation } from '@/src/server/photo-jobs/assets';`
// and `import { runPhotoJob }` stays as it is.
// Everything else — job, ORIGINAL, slot(), beforeEach, the mock return values —
// is reused unchanged, which is the point: the P1 expectations must still hold.
vi.mock('@/src/lib/rendering/blend', () => ({ blendSubject: deps.blendSubject }));

// The template row now carries the blend columns, so the stub does too.
function template(overrides: Record<string, unknown> = {}) {
  return { templateId: 'tpl-1', templateVersion: 4,
    templateUrl: 'https://cdn.test/template.png', templateWidth: 1080, templateHeight: 1350,
    photoMode: 'auto', blendPreset: 'natural', blendSettings: null, foregroundSlots: [],
    slot: slot(), ...overrides };
}

const blended = {
  subjectPng: Buffer.from('blended-png'),
  placement: { source: { x: 0, y: 0, width: 100, height: 100 },
    target: { left: 10, top: 20, width: 300, height: 400 },
    faceOnCanvas: { x: 120, y: 60, width: 60, height: 80 },
    anchor: 'bottom' as const, mode: 'background' as const, scale: 3 },
  underlays: [{ buffer: Buffer.from('drop'), left: -14, top: -4 }],
  faceSafe: { face: { x: 120, y: 60, width: 60, height: 80 }, strength: 0.92 },
  decisions: { applied: true, preset: 'natural', mode: 'background' },
};

beforeEach(() => {
  // P1 reads the original once as a liveness probe; P2 reads two more things —
  // the vendor cutout and the template — so the stub answers by URL and each
  // read is distinguishable in the assertions.
  deps.readAssetBytes.mockImplementation(async ({ storage_key, provider_url }: AssetLocation) => {
    if (storage_key === ORIGINAL.storage_key) return Buffer.from('original-bytes');
    if (provider_url === 'https://cut.test/x.png') return Buffer.from('cutout-png-bytes');
    if (provider_url === 'https://cdn.test/template.png') return Buffer.from('template-png-bytes');
    return null;
  });
  deps.blendSubject.mockResolvedValue(blended);
});

const kinds = () => deps.upsertPhotoAsset.mock.calls.map((call) => call[0].kind);
const finalCall = () => deps.upsertPhotoAsset.mock.calls.find((call) => call[0].kind === 'final')![0];

describe('runPhotoJob with the blend engine', () => {
  it('composites through the blend and records the decisions on the final asset', async () => {
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(deps.blendSubject).toHaveBeenCalledTimes(1);
    const request = deps.blendSubject.mock.calls[0][0];
    expect(request.templatePng).toEqual(Buffer.from('template-png-bytes')); // bytes, not a URL
    expect(request.canvas).toEqual({ width: 1080, height: 1350 });
    expect(request.slot.x).toBe(10);
    const composited = deps.compositeImage.mock.calls[0][0];
    expect(composited.templateBytes).toEqual(Buffer.from('template-png-bytes'));
    expect(composited.slots[0].photo_bytes).toEqual(Buffer.from('blended-png'));
    expect(composited.slots[0].placement).toEqual(blended.placement);
    expect(composited.underlays).toEqual(blended.underlays);
    expect(composited.faceSafe).toEqual(blended.faceSafe);
    expect(finalCall().renderParams.blend).toEqual(blended.decisions);       // §14.11
    expect(kinds()).toEqual(['transparent', 'final', 'preview', 'thumbnail']);
    expect(kinds()).not.toContain('original');                               // §14.12
  });

  it('degrades to the P1 paste when the blend throws, and still reaches ready', async () => {
    deps.blendSubject.mockRejectedValue(new Error('median exploded'));
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(deps.compositeImage).toHaveBeenCalledTimes(1);            // rendered, just not blended
    const composited = deps.compositeImage.mock.calls[0][0];
    expect(composited.slots[0].photo_url).toBe('https://cut.test/x.png'); // the legacy URL path
    expect(composited).not.toHaveProperty('underlays');
    expect(finalCall().renderParams.blend).toEqual({ applied: false, preset: 'natural', error: 'median exploded' });
  });

  it('skips the engine entirely for preset "off"', async () => {
    deps.resolveActiveTemplateForContest.mockResolvedValue(template({ blendPreset: 'off' }));
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(deps.blendSubject).not.toHaveBeenCalled();
    expect(deps.compositeImage.mock.calls[0][0].slots[0].photo_url).toBe('https://cut.test/x.png');
    expect(finalCall().renderParams.blend).toEqual({ applied: false, preset: 'off' });
  });

  it('feeds the engine the cutout bytes, never the original', async () => {
    await runPhotoJob(job as never);
    expect(deps.blendSubject.mock.calls[0][0].subjectPng).toEqual(Buffer.from('cutout-png-bytes'));
    expect(deps.blendSubject.mock.calls[0][0].templatePng).toEqual(Buffer.from('template-png-bytes'));
    // original probe + cutout + template. A fourth read, or a subjectPng equal to
    // 'original-bytes', would mean the engine is being handed the photograph itself.
    const reads = deps.readAssetBytes.mock.calls.map((call) => call[0]);
    expect(reads[0]).toMatchObject({ id: 'asset-original' });   // P1's liveness probe, unchanged
    expect(reads.slice(1)).toEqual([
      { storage_key: null, provider_url: 'https://cut.test/x.png' },
      { storage_key: null, provider_url: 'https://cdn.test/template.png' },
    ]);
  });
});
```

Two details the test pins down on purpose. First, P1 reads the original's bytes only as a liveness probe and then works by URL; P2 needs pixels, so it reads two more things — the vendor cutout and the template — and the exact `readAssetBytes` argument list is what proves the engine is handed the cutout rather than the photograph. Second, `blendSettings: null` and `foregroundSlots: []` are in the stub because `resolveActiveTemplateForContest` is the only place those columns are read; a resolver that forgets to select them fails the resolver test below, not this one.

Still in Step 1, extend `tests/unit/registration/template-resolver.test.ts`. Its `makeChain` mock records every `select()` column list in `state.selected` and answers `template_slots` from one variable, so the second query needs three things in the harness:

```ts
// 1. state gains:  foregroundResult: any; foregroundError: any;
//    reset both in beforeEach (foregroundResult = null, foregroundError = null).
// 2. makeChain's chain object gains the two terminals the resolver uses:
//      not: () => chain,
//      then: (resolve: (v: unknown) => void) =>
//        resolve({ data: state.foregroundResult, error: state.foregroundError }),
//    — the list query is awaited directly (`.then` is what supabase-js makes a
//    query builder), while the existing contestant query still ends in
//    `maybeSingle()`, which keeps answering from state.slotResult. So the two
//    template_slots reads are distinguished by their terminal, not by a counter.
// 3. the two tests below.

it('selects the blend columns and the foreground slots', async () => {
  state.templateResult = { id: 'tpl-1', version: 3, template_url: 'https://cdn/t.png', width: 1080, height: 1350,
    photo_mode: 'photo_area', blend_preset: 'studio', blend_settings: { edge: { featherPx: 1 } } };
  state.slotResult = { id: 'slot-1', slot_name: 'Main', slot_type: 'contestant', slot_order: 0,
    x: 10, y: 20, width: 300, height: 400, rotation: 0, z_index: 1, scale: 1,
    crop_mode: 'cover', border_radius: 0, opacity: 1,
    image_url: null, anchor: 'auto', bleed: false, face_protect: true };
  state.foregroundResult = [
    { id: 's2', slot_name: 'Banner', slot_type: 'badge', slot_order: 1,
      x: 0, y: 0, width: 100, height: 40, rotation: 0, z_index: 9, scale: 1,
      crop_mode: 'cover', border_radius: 0, opacity: 1,
      image_url: 'https://cdn/banner.png', anchor: 'auto', bleed: false, face_protect: true },
  ];

  const result = await resolveActiveTemplateForContest('contest-1');
  expect(result).toMatchObject({ photoMode: 'photo_area', blendPreset: 'studio',
    blendSettings: { edge: { featherPx: 1 } } });
  expect(result!.foregroundSlots).toHaveLength(1);
  expect(result!.foregroundSlots[0]).toMatchObject({ id: 's2', z_index: 9, image_url: 'https://cdn/banner.png' });
  // The regression this pins: a query that stopped selecting a column would still
  // get a full row back from the mock, so assert the column lists themselves.
  expect(state.selected.find((s) => s.startsWith('contest_templates:'))).toBe(
    'contest_templates:id, version, template_url, width, height, photo_mode, blend_preset, blend_settings');
  expect(state.selected.find((s) => s.startsWith('template_slots:'))).toMatch(/image_url, anchor, bleed, face_protect/);
});

it('tolerates a template with no foreground slots', async () => {
  state.templateResult = { id: 'tpl-1', version: 1, template_url: 'https://cdn/t.png', width: 100, height: 100,
    photo_mode: 'background', blend_preset: 'off', blend_settings: null };
  state.slotResult = { id: 'slot-1', slot_name: 'Main', slot_type: 'contestant', slot_order: 0,
    x: 0, y: 0, width: 50, height: 50, rotation: 0, z_index: 1, scale: 1,
    crop_mode: 'cover', border_radius: 0, opacity: 1,
    image_url: null, anchor: 'auto', bleed: false, face_protect: true };
  state.foregroundResult = [];
  const result = await resolveActiveTemplateForContest('contest-1');
  expect(result!.blendPreset).toBe('off');
  expect(result!.foregroundSlots).toEqual([]);
});
```

The existing five cases in that file keep passing untouched: they never set `foregroundResult`, so the new query resolves `null` and the resolver maps that to `foregroundSlots: []`.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/unit/photo-jobs/blend/runner-blend.test.ts tests/unit/registration/template-resolver.test.ts`; the resolver cases fail on `photoMode` being `undefined`, the runner cases on `blendSubject` not being called.
- [ ] **Step 3: Implement**
  - `template-resolver.ts`: extend the `select` to `'id, version, template_url, width, height, photo_mode, blend_preset, blend_settings'`, select the new slot columns, and add a second query for the non-`contestant` slots with an `image_url`, ordered by `z_index`. `ResolvedTemplate` gains `photoMode`, `blendPreset`, `blendSettings`, `foregroundSlots`.
  - `runner.ts` `compositing` step: read the cutout and the template bytes once each — `readAssetBytes({ storage_key: null, provider_url: cutout.resultUrl })` and `readAssetBytes({ storage_key: null, provider_url: template.templateUrl })` — resolve `params = resolveBlendParams(template.blendPreset, template.blendSettings)`, and when `isBlendDisabled(params)` is false and both buffers came back, call `blendSubject({ subjectPng: cutoutBytes, templatePng: templateBytes, canvas: { width: template.templateWidth, height: template.templateHeight }, slot: template.slot, params, overrides: job.render_params })` inside a `try`. Pass its output plus `template.foregroundSlots` to `compositeImage` as in Task 8; on throw, or when either buffer is `null`, fall back to today's single-slot URL call and set `decisions = { applied: false, preset, error }` (with `error: 'the cutout or template bytes could not be read'` for the null case). Store the `transparent` asset from the cutout as P1 does, then the `final` with `renderParams: { ...job.render_params, blend: decisions }`. For a disabled blend, skip the engine and the two extra reads and record `{ applied: false, preset }`.
  - `photo-pipeline.ts` (the synchronous path P3 will call) gets the same treatment behind an optional `blend` input field so a P3 preview can request it, and its existing tests stay green with `blend` absent.
- [ ] **Step 4: Run to verify it passes** — `npx vitest run tests/unit/photo-jobs tests/unit/registration tests/unit/rendering`; then `npm run type-check`.
- [ ] **Step 5: Commit** `git commit -m "feat(photo): render contestants through the blend engine, with a proven fallback"`

---

### Task 11: Proof, replay, and the PR

**Files:**
- Modify: `docs/superpowers/plans/2026-11-27-contest-photo-blend-layer.md` (this file — close the boxes, add the executed-sha headers and the corrections list)
- Modify: `docs/superpowers/specs/2026-11-27-contest-photo-blend-layer-design.md` (§15/§16 only if delivery narrows a claim)

- [ ] **Step 1: Full local gate set** — `cd frontend-web && npx vitest run` (whole suite) and `npm run type-check`; then the repo guards: `bash scripts/ci/check-migration-versions.sh`, `python3 scripts/ci/check-sql-param-order.py supabase/migrations`. Expected: the four pre-existing reds named in P1's ledger (`contest-admin-schedule-route` ×2, `wallet/bank` ×2, `beat-download-origin` ×1) and nothing else; say so in the PR rather than fixing them silently.
- [ ] **Step 2: Equivalence proof for §14.11** — render one synthetic case with `blend_preset: 'off'` against this branch and against a worktree at `feat/contest-photo-assets-jobs`'s merge-base parent, and record both buffers' sha256 in this plan. A blend-off render that differs from P1 is a bug in Task 8, and this is the step that catches it.
- [ ] **Step 3: Merged-chain replay in a throwaway Postgres** — the P1 recipe (`docker run postgis/postgis:17-3.4`, `max_locks_per_transaction=512`, `scripts/ci/supabase-compat-prelude.sql`, `make MIGRATIONS_DIR=<merged chain> migrate-up`), with the chain = `merge-base..origin/main` ∪ `merge-base..HEAD`. Assert the new columns exist with their defaults on the merged tip, that `make MIGRATIONS_DIR=… rls-check` passes, and that the count is stated from the measured file count, not arithmetic done in prose (the P1 lesson).
- [ ] **Step 4: Duplicate-version check against `origin/main` after the fetch**, and renumber *this* migration if `main` gained `202722*` while the branch sat open.
- [ ] **Step 5: Push the branch and open a PR whose base is `feat/contest-photo-assets-jobs`**, with a body that states: what is proven by tests; that "professionally blended" is proven numerically on synthetic geometry and NOT proven visually on real photographs (spec §15.2); that the runner needs Cloudinary and R2 configuration to reach a real composite; that P2 is engine-only with no admin UI (P3) and no surface change (P4); that this PR is stackable and merging it before #1180 would be wrong; and the pre-existing failures by name.
- [ ] **Step 6: Do not merge.** Report the CI census from `check-runs --paginate` and leave integration to the owner.

---

## Corrections to the draft

*(Appended during execution; the plan above is what was written before any code was run.)*

1. spec §12 is the normative preset table; this plan's Task 2 test asserts a subset of its keys — if a key is renamed the table wins and the test follows it.
2. `refineEdges` needs the slot dimensions for its feather cap (spec §5.3 caps on the *slot*, not the image), which the draft's Task 5 signature omitted. Task 5 Step 3 makes that explicit; the parameter is added to the real signature.
3. Task 8's first test cannot compare against `main`'s code from inside this branch's test run. The byte-identity half moves to Task 11 Step 2, where two worktrees can be run and hashed; the in-branch test asserts the unchanged-when-absent *shape* only.
4. Task 4's width-cap fixture was redesigned. The draft's figure made `measureSubject`'s top-12 % row scan land on the shoulder row, so `headWidth` came back as 900 and the width cap could never bind; the committed fixture is a 100×100 head at y 100 with 900 px shoulders from row 200, which yields scale 4/9 and a 400×356 box.
5. Task 4's editor-offset test asked for a translate *and* a rescale in one assertion against a bottom-anchored box — unsatisfiable, because re-scaling moves the feet. It is now two cases: `{ xOffset, yOffset }` alone, and `{ scale }` alone.
6. Task 5's feather cap follows spec §5.3 as written — `min(preset.featherPx, max(1, round(min(slotW, slotH) × 0.004)))` — not the draft's `floor(…)`. The draft's form silently switched feathering off in every slot narrower than 250 px, which contradicts the §12 table that owns the number. The committed test pins 2 px in a 1000 px slot, 1 px in a 60 px slot, and 0 px for a preset that asked for none.
7. Task 5 also put `image_url`, `anchor`, `bleed` and `face_protect` on `SlotConfig` as optional fields, which the draft left for Task 8: `photo_area` was unreachable from Task 4's own typed factory without it, and an intersection alias would have made two types agree by accident. `PlacementSlot` is now an alias of `SlotConfig`.
8. Task 6's `RegionStats` gained `spread` — `p90 − p10` of luma over opaque pixels. The draft's interface carried only means, so §6.3's contrast term had nothing to be computed from; a `spread` of 0 on either side makes that term decline rather than divide by zero.
9. Task 6's fixtures were redesigned. The draft's `grey(135)` strips put every expected value within 0.5 of an 8-bit rounding boundary, and its comment's arithmetic was wrong (`140 × 0.97 / 135` is 1.006, not 1.037). The committed fixtures are two-tone strips with exact, averaged-out means, and each of the three corrections is isolated by a reference that neutralises the other two (neutral R = G = B kills temperature, equal spreads kill contrast, a matched `meanLuma` keeps gain inside its bound) so `clamped` can be asserted with `toEqual`.
10. Task 6's `matchLight` takes the reference as a `RegionStats` value, not the template buffer, so the template is decoded once per job — that read belongs to Task 9 — and with no reference it returns the buffer it was handed rather than a re-encode.
11. Task 7's contact band is canvas rows **165..171**, not the draft's 164..170: `hypot < 20` is false at exactly 20, so the disc fixture's last matte row is 69 (`measureSubject.bottomY` confirms it) and §7's `[bboxBottom − contactHeight, bboxBottom + 2]` hangs off 169. The draft's three probes still land where it meant them to, and its `> 50` count holds with room to spare (≈ 132 band pixels survive the mask before the blur, more after).
12. Task 7 implements §7's ordering explicitly: blur first, then multiply by `1 − alphaSubject`. Masking before the blur would smear the band back into the figure and fail the "no outline, no glow" test. The contact layer also gets **no** `shadowOffsetPx` — the draft gave both layers the same offset, which pushes a contact shadow off the feet it is supposed to be touching.
13. Task 7's mode rule is `off → []`, `auto` + clip → `[]`, `on` + clip → both layers. The draft's "clip → []" dropped §7's override, and the committed test pins all three cases plus the both-opacities-zero case.
14. Task 7's `protectFace` takes `{ target, face, strength }` — `Placement.target` and `Placement.faceOnCanvas` shapes, so Task 8 has no third coordinate type to convert — and clips the cut to the slot. Its falloff is linear in the normalised ellipse radius *inside* the box and continues to zero 20 % past it; the draft's "fully reduced inside, restored outside" reading would have made the mid-face probe equal the centre probe and fail §8.2's monotonicity requirement.
15. The separable box blur §5.3 already had moved to `blend/box-blur.ts`, shared with the shadows instead of duplicated. `radiusForSigma()` inverts the two-pass variance (`σ² = (w² − 1) / 6`) so §12's blur pixels mean a blur, not a sticker edge; the drop shadow is two passes at that radius, the contact band one pass at `contactHeight / 2`.
