# Contest photo blend layer — design (P2)

Status: approved in direction by the requester ("take charge, continue and complete"; scope
chosen as "Everything + the photographic blend layer").
Owner of implementation: this repo, `frontend-web` (Next.js BFF) + `supabase/migrations`.
Companion to the attached product spec "SPOTLIGHT — AI CONTESTANT PHOTO COMPOSITING &
TEMPLATE MANAGEMENT SYSTEM", which this document covers as sub-project 2 of 4 (§5
INTELLIGENT PORTRAIT POSITIONING and §6 PROFESSIONAL PHOTO BLENDING AND COMPOSITING).
Depends on P1 (`docs/superpowers/specs/2026-11-26-contest-photo-assets-and-jobs-design.md`),
whose asset table, job queue and provider seam this layer runs inside.

## 1. What this sub-project is, and the line it draws

P1 made compositing *possible and safe*: the original photograph is never overwritten, every
render is a durable job with a truthful status, and the cutout, final and variants are separate
asset rows. P1 also, deliberately, shipped a renderer whose quality was unchanged — the runner
calls the compositor that already existed, which resizes the cutout into the slot and pastes it.

That renderer is what this spec replaces. The attached spec is blunt about it (§6):

> Do not simply remove the background and place the contestant on another image.
> The system must produce a professionally blended composition.

P2 therefore owns the three things between "we have a transparent PNG" and "we have a published
portrait": where the subject is placed (§5), how it is made to belong to the frame (§6 A–D), and
what the final file is (§6 E). It does not own the admin UI that configures any of it (P3), the
contestant's own editor (P4), or the surfaces that display the result (P4).

| In scope (§ references) | Out of scope |
|---|---|
| Placement engine: subject measurement, Mode A / Mode B fit, anchor, bleed (§5, §3 modes) | The admin studio that sets those fields (P3) |
| Edge refinement, colour/light matching, shadows, face-safe layering (§6 A–D) | Background removal itself — the provider seam from P1 (§4) |
| Final encoding policy and the `final` asset's recorded decisions (§6 E, §11) | Drag/zoom/scale UX and `USE THIS PHOTO` (§7, P4) |
| The template columns the renderer reads, with safe defaults | Publishing, draft/version UI, sample-portrait preview (§8, P3) |
| Runner wiring: the `compositing` step becomes the blend pass | Regeneration UX, surfaces, mobile (§9, §13, §15 — P4) |

Everything here is local computation on bytes already in our hands. No new vendor call, no new
service, no new dependency: `sharp` (0.35.5 / libvips 8.18.7, measured below) does decode, resize,
composite and encode, and a handful of pixel passes in TypeScript do what libvips cannot express
in one operator.

## 2. What exists today, verified from the tree

Established by reading the code and by executing probes, not inferred:

- `frontend-web/src/lib/rendering/imageCompositor.ts` (260 lines) is the whole renderer. Its
  per-slot pipeline is fetch → `resize(w,h,{fit})` → `rotate(…, {background: alpha 0})` →
  an SVG `rect rx/ry` mask composited with `dest-in` for `border_radius` → an alpha multiply for
  `opacity` → clamp `left`/`top` to ≥ 0 → `blend: 'over'`. Slots and text overlays are sorted by
  `z_index` ascending and composited onto the template in one `sharp().composite([...])` call,
  then encoded `.png()`. It has no notion of the subject, no crop gravity, no shadow, no colour
  work, and it refetches every image by URL.
- `frontend-web/src/server/photo-jobs/runner.ts:119` is the live caller, and its slot list is
  exactly `[{ ...template.slot, photo_url: cutout.resultUrl || fetchable.url }]` — one contestant
  slot, no foreground art. Its comment at `runner.ts:63` already says "In P2 this same read
  becomes the pixel source": `readAssetBytes(source)` is fetched today and thrown away, only to
  prove the original is readable.
- `frontend-web/src/server/registration/photo-pipeline.ts:137` is the second (currently
  test-only, P3-intended) caller with the same single-slot shape.
- `frontend-web/src/server/registration/template-resolver.ts` returns `templateId`,
  `templateVersion`, `templateUrl`, `templateWidth`, `templateHeight` and one `SlotConfig` built
  from the first `contestant` slot ordered by `slot_order`. It selects no placement or blend
  columns, because none exist.
- `supabase/migrations/20260405700000_contest_image_templates.sql` defines `contest_templates`
  (no mode, no blend, no overlay column) and `template_slots` (`x, y, width, height, rotation,
  z_index, scale, crop_mode, border_radius, opacity, snap_to_grid, grid_size` — no anchor, no
  bleed, no face-protect, and no image URL for a slot that is decorative art rather than a
  person). `template_slot_type` is the enum `('contestant','runner_up','badge','logo','custom')`,
  so the layer vocabulary the spec asks for exists; the placement policy does not.
- P1's `20272100000000_contest_photo_assets_and_jobs.sql` gives `contest_photo_assets.render_params
  jsonb NOT NULL DEFAULT '{}'::jsonb`, which is where the blend's decisions get recorded without a
  new column, and `contest_photo_jobs.render_params`, which keys idempotency — so a blend change
  that must re-render is expressible as a params change and nothing else.
- No file under `frontend-web/src` contains `sharpen`, `modulate`, `normalise`, `linear`, `median`,
  `dilate`, `erode`, `joinChannel` or `boolean` (grep). The blend layer is genuinely new code, not
  a re-exposure of something present.
- Operator availability, measured on this machine's installed libvips rather than assumed
  (`node -e` against `frontend-web/node_modules/sharp`): `median`, `blur`, `dilate`, `erode`,
  `linear`, `joinChannel`, `boolean`, `sharpen`, `modulate`, `normalise`, `threshold`, `gamma`,
  `tint`, `composite`, `resize`, `extend`, `extract` are functions; `convolution`, `unsharp` and
  `affineTransform` are **not**. Two traps the probe found, both of which the design is built
  around: `extractChannel(n).toBuffer()` without `.raw()` hands back *encoded PNG bytes* while
  `info.channels` says 1 — reading those as pixels yields the file header — and morphology on a
  single-band raw input promotes the result to 3 channels with the value replicated. Every alpha
  pass in this design therefore goes through `.raw()` with an explicit `{width, height, channels}`
  and reduces the band itself, which is deterministic and unit-testable, instead of fighting those
  two behaviours.
- `frontend-web/src/lib/media/cloudinary.ts` offers `moderatePhoto` and `removeBackground`
  (`background_removal: cloudinary_ai`), carries its own `// TODO: verify against live Cloudinary
  docs`, and no server-side `CLOUDINARY_*` value is settable from here. §10.

### Correction to the P1 design record

`2026-11-26-…-design.md:94-103` recorded P2's approach as "hybrid: Cloudinary owns subject
extraction, edge feathering and colour/lighting match; sharp owns geometry, contact shadow,
z-order layering, text overlays and variant resizing", rejecting "all-sharp" on the grounds that
"hand-tuned alpha morphology will not hold hair and clothing detail".

The first half of that sentence stands and is the reason P2 is cheap: **the provider still owns
subject extraction**, and the segmentation model — not our morphology — is what keeps an afro, a
braid or a veil intact. The second half does not survive the attached spec, for one reason that is
a requirement rather than a taste:

> §6.B … Do not blindly apply identical colour filters to all contestants.

A vendor enhancement effect is, by construction, the same function of the image in front of it. It
cannot know the template: it has no reference for the light in this frame, the tone of that
background, or the fact that this particular contestant was shot in shade while the campaign art is
studio-lit. Colour and lighting *matching* is therefore not a vendor call at all — it is a
measurement of two images we already hold. Delegating it would either apply an identical filter to
every contestant (forbidden) or require a per-contestant parameter we would have to compute here
anyway and then hand to a vendor we cannot verify (see §10).

So the corrected split, which is what this document implements:

| Concern | Owner | Why |
|---|---|---|
| Foreground segmentation (hair, clothing, contours) | Provider (`cloudinary_ai`), unchanged | The model is the only thing that can hold §4's hair types; morphology on top of it only cleans its output |
| Edge fringe, residual background colour, stray speckles | **Local**, §5 | These are defects *of the cutout*, measurable from its own alpha; the vendor has no idea which pixels are ours to fix |
| Colour, exposure, contrast, temperature match | **Local**, §6 | Requires the template's statistics as the reference; the constraint is per-contestant difference |
| Contact/drop shadow, subject separation | **Local**, §7 | Geometry and alpha only; no vendor effect can be driven from the slot rect |
| Layer order, face-safe foreground clipping | **Local**, §8 | The compositor owns z-order today; face protection needs the placement metrics from §4 |
| Final encoding policy | **Local**, §9 | Two encodes and a size comparison; nothing to delegate |
| Variant resizing | Existing `photo-jobs/variants.ts`, untouched | P1's "one resize driven by the composite" reasoning still holds |

The rejected alternative that P1's paragraph correctly rejected remains rejected: doing
segmentation locally. Nothing here re-derives the matte.

## 3. Decisions taken, and the alternatives rejected

**Placement is measured from the cutout's alpha, not from a landmark model.** §5 asks for face,
head, shoulder, torso and boundary positions. The matte we already have is a per-pixel answer to
"where is the person", and from it a row/column density profile yields head top, the width step
that is the shoulder line, the body bbox and a derived face box — deterministically, in a few
hundred lines, with no new dependency, no new egress of a contestant's face to a third party, and
no per-render cost. §4's appearance-preservation rules ("must not alter facial structure") make a
landmark model a liability rather than a feature: the only thing we may do with a face is decline
to cover it. Rejected: a face-detection dependency (MediaPipe/BlazeFace or a vendor landmark API) —
it adds a model and a download, sends biometric-adjacent data to a third party for §16's purposes,
and buys accuracy we do not need for the two placement decisions that matter (how big, how high).
The derived face box is used *only* as a protected region (§8), never as a crop target, so its
inaccuracy is harmless.

**Blend is opt-in per template and falls back to today's behaviour, never to nothing.** The new
engine is reached only when the slot's template resolves a `blend_preset` other than `off`; any
throw inside the blend is caught at its own boundary, logged, and the render continues on the
P1 path (cutout into slot, no refinement). That is the runner's all-or-nothing rule unchanged — a
`final` asset still implies a stored composite — and it means P2 cannot take production portraits
down if a pixel pass misbehaves on an input shape we have not seen. Rejected: fail the job on a
blend throw, which would trade a hard-edged paste for no portrait at all and, per spec §12, is
exactly the "incomplete portrait" outcome the failure rules are written against. The fallback is
recorded in the asset's `render_params.blend`, so it is visible rather than silent (§10).

**Mode is stored, with an inferred default.** §3's two modes change placement, not just looks:
Mode A places a whole subject onto art, Mode B drops a subject *into a window* that must be filled
and may clip it. Neither `contest_templates` nor `template_slots` can say which is in force today.
P2 adds the columns the renderer reads (§11) and defaults `photo_mode` to `'auto'`, where auto
means: sample the template's alpha under the slot rect — if a majority of that rect is
transparent, the admin cut a window and this is Mode B; otherwise it is Mode A. That inference is
one `extractChannel(3)` and a count, it is testable, and it means every template that exists today
gets the right placement without an admin action. Rejected: hard-coding Mode A, which would
stretch a portrait out of a circular frame; rejected: making the mode mandatory-before-render,
which would break every existing contest at the moment of deploy.

**Presets are named knobs, not per-template tuning.** `natural` (default) / `studio` / `bold` /
`off`, each a full parameter table with exact numbers (§12), and `blend_settings` jsonb holding
per-contest overrides of individual keys only, validated and clamped on read. P1's spec already
promised admin-selectable presets rather than hard-coded tuning; this keeps that promise with one
column of state and no new UI dependency. Rejected: free numeric tuning in P2 (an admin can drag a
"feather" slider into a blurry subject — P3's job is to present bounded choices, and the clamps make
the unbounded version unreachable).

**The compositor takes pixels when it already has them.** `SlotConfig` gains
`photo_bytes?: Buffer` and `CompositorInput` gains `template_bytes?: Buffer` and an optional
`blend?: BlendRequest`. Both live callers already hold or can hold bytes: the runner has the
original bytes from `readAssetBytes` and will have the cutout URL; P3's preview will have an upload
in hand. Rejected: a separate `blendComposite()` that duplicates the slot/z-order/encode logic —
two renderers is how geometry and layering start to disagree, which is the argument
`variants.ts:1-16` already makes. One renderer, one set of layers, one encode.

**The final file is chosen, not declared.** Encode JPEG q90 and PNG, keep the smaller, with JPEG
refused when the composite carries transparency (a template whose window is a cutout, or a subject
with a transparent surround). `final.content_type` and `bytes` already record whichever won, and
`variants.ts`'s deferred line — "format choice belongs with P2's styling pass, where there is a
designed background to flatten onto" — is answered by measurement rather than a rule: a flat
graphic template with text beats JPEG, a photographic backdrop beats PNG, and we do not have to
guess which is which. Rejected: "always PNG" (a 1080×1350 photographic composite is several times
the size, and P4 serves it on every listing card) and "always JPEG for opaque" (branding edges and
text ring).

## 4. Data flow, end to end

```
claimed job (P1)                                  runner.ts
  ├─ source asset read         ────────────────►  bytes (already read today at runner.ts:63)
  ├─ provider.extractBackground(cutout URL)  ──►  transparent asset  (unchanged)
  └─ compositing step:
       templateBytes  ◄── read once, kept in hand
       subjectBytes   ◄── cutout bytes, read once
       1  measureSubject(subjectBytes)           → SubjectMetrics
       2  resolveMode(templateBytes, slot)       → 'background' | 'photo_area'
       3  planPlacement(mode, slot, metrics)     → { x, y, w, h, fit, gravity, bleed }
       4  refineEdges(subjectBytes, preset)      → subject PNG (defringed, despeckled, ≤ cap feather)
       5  measureRegion(templateBytes, rect)     → backdrop stats
       6  matchLight(subject, backdrop, preset)  → subject PNG + what was applied
       7  buildShadow(subjectAlpha, rect)        → shadow layer PNG
       8  compositeImage({template_bytes, slots:[shadow? z−0.5, subject], overlay slot, text, blend})
             └─ §8 face-safe clip of anything whose z is above the subject and whose rect
                intersects the derived face box
             └─ §9 encode both, keep the smaller, refuse JPEG on transparency
       9  store → upsert kind 'final' with render_params.blend = the applied record
```

The original photograph is read at step 0 and never again written, which is P1's invariant and
this layer's inheritance: nothing in §5–§12 is expressed as an update to an `original` row, and
`contest_photo_assets_immutable` still enforces it at the database.

## 5. Edge refinement (§6 A)

Three passes over the cutout, each bounded, each measured from the image rather than applied
blindly, and all of them operating on the *alpha* channel plus the fringe pixels only.

**5.1 Residual background colour (defringe).** A segmentation matte is soft, so the pixels at the
boundary are a blend of subject and the old background: that is the grey-green halo around hair
that reads instantly as "pasted". Estimate the background colour as the median RGB of pixels with
`alpha < 32` inside the bbox margin ring (that band is what the vendor left behind), then for every
pixel with `0 < alpha < 255`, unmix it: `c' = (c − (1 − a) · bg) / a`, clamped to [0, 255]. Fully
opaque pixels and fully transparent pixels are untouched, so clothing texture and the interior of
the subject keep their exact values. §6.A's "preserve natural clothing details" is satisfied by the
invariant that the pass only reads pixels the matte already says are mixed.

**5.2 Stray speckles and holes.** Connected components on `alpha ≥ 8`: the largest component is the
subject; components smaller than the preset's `speckleMinArea` are dropped to zero (a floating
patch of background colour is worse than a missing hair wisp), and small holes *inside* the subject
bbox whose alpha is below the threshold are closed to opaque. Implemented as two flood fills over
the raw alpha array — the same shape of computation libvips `dilate`/`erode` would do, chosen
because the probe in §2 found those operators promote a single-band result to 3 channels and the
band bookkeeping costs more clarity than a 40-line fill costs correctness.

**5.3 Edge smoothing, with the feather explicitly capped.** "Smooth irregular segmentation edges"
and "avoid excessive feathering" are the same dial seen from two sides, so the dial is a number in
the table in §12 and the code clamps it again: `featherPx = min(preset.featherPx,
max(1, round(min(slotW, slotH) × 0.004)))` and the blur is applied to the alpha band alone
(separable box blur, radius ≤ 2), never to RGB, so softening a matte edge cannot smudge skin.

**Not here:** glow, artificial outlines, or any stroke. §4's "avoid artificial outlines" and §6.C's
"avoid unrealistic glow, artificial outlines" rule them out, and a 1 px opaque ring around a
subject is exactly what makes a composite read as fake.

## 6. Colour and lighting matching (§6 B)

Per contestant, because the spec forbids anything else.

**6.1 Measure the subject** over pixels with `alpha ≥ 200`: mean of R, G, B; mean Rec.709 relative
luminance; the 10th and 90th percentile luminance (its contrast spread); and the warmth ratio
`meanR / meanB`.

**6.2 Measure the reference** — the template's *neighbourhood of the subject*, not the whole
canvas: the rect the placement will occupy, dilated by 25% and with the placement rect itself
excluded, using only pixels at `alpha ≥ 200` (a Mode B window is transparent, so its neighbourhood
is the lit art around it). Same four statistics. Using the neighbourhood rather than the frame
average is what makes a subject placed against a dark bottom band not get brightened into a grey
top band.

**6.3 Derive bounded corrections** from the two stat sets, then apply only a fraction of the
result, so the subject keeps its own exposure character instead of being welded to the backdrop:

- `targetLuma = refLuma × preset.lumaBias` (natural 0.97, studio 1.00, bold 1.03)
- `gain = clamp(targetLuma / subjectLuma, preset.gainMin, preset.gainMax)`
- `temperature = clamp((refR / refB) / (subjectR / subjectB), 1 − preset.tempMax, 1 + preset.tempMax)`
  applied as a *gain* on R and B (never a hue rotation), so skin is nudged toward the frame's white
  balance and cannot be recoloured
- contrast: rescale luminance spread toward the reference spread, capped at `±preset.contrastMax`,
  as a linear around the subject's own mean so nothing clips to black or white
- everything is applied as per-channel `linear`-style arithmetic on RGB only.

With those bounds the largest *luminance* gain any preset can apply is 1.25×, and the largest
per-channel multiplier is that gain times the temperature ceiling — `1.25 × 1.09 ≈ 1.36×` on R or B
alone at `bold`, `1.08 × 1.04 ≈ 1.12×` at `natural`. §4's "must not change skin tone" is enforced by
those two numbers plus the no-hue-rotation rule; §6.B's "adjust exposure carefully" is the fraction.

**6.4 Record what was applied** — `{subjectLuma, refLuma, gain, temperature, contrast, clamped}` —
into `render_params.blend` on the `final` asset. "Not identical filters" is then not a claim but a
row-level fact: two contestants under the same template provably got different numbers, and an
operator comparing two portraits can see why.

## 7. Shadows and depth (§6 C)

A shadow built from the subject's own silhouette, in two parts, both masked so they can only appear
where the subject is not.

- **Drop shadow:** alpha box-blurred by `preset.shadowBlurPx`, scaled 1.02 about its centre,
  offset by `(0, preset.shadowOffsetPx)`, tinted `#000`, at `preset.dropOpacity`.
- **Contact shadow:** a separate, stronger, *flatter* pass on the alpha (a 1×`contactHeight`
  blur, anchored to the silhouette's bottom rows), at `preset.contactOpacity`, so a standing figure
  grounds to the artwork. `natural` and `studio` render it; `bold` doubles it.
- `layering.shadow` is one of `'auto' | 'on' | 'off'`; `auto` means on for Mode A, off when the slot
  clips (`border_radius > 0`), because a shadow inside a circular window lands on the window's own
  art and reads as a smudge.
- Both layers are multiplied by `1 − alphaSubject` before compositing. That single mask is why §6.C's
  prohibitions hold by construction: no glow (a shadow only removes light), no outline (nothing is
  drawn where the subject is), and the opacity ceilings in §12 (max 0.28 combined) are what keep
  "avoid excessive shadow effects" from depending on tuning.

## 8. Layering and face-safe foregrounds (§6 D)

Order, per §3's list: background artwork → contestant subject → optional foreground overlay → text
and logos. The compositor already sorts by `z_index`, so P2's job is two things:

**8.1 Foreground art is loadable.** A decorative overlay is a slot like any other, but today a slot
has no image column — `photo_url` is filled in by the caller with a *person*. P2 adds
`template_slots.image_url` and `face_protect`, and the resolver returns the non-contestant slots in
`z_index` order so the runner can pass them through. This is the storage half only; drawing the
overlay in an admin UI is P3's.

**8.2 The face is a protected region.** For every layer whose `z_index` is above the contestant
slot's and whose rect intersects the derived face box, the layer's alpha is reduced *inside* that
box by `faceProtectStrength` and restored along a 20 % feathered band outside it. So a laurel, a
ribbon or a frame edge can cross a shoulder and stay crossed, and cannot put a banner across eyes.
Default `face_protect = true`, and the strength is a preset number rather than an admin
guess. `natural` and `studio` protect fully (0.92 / 0.85); `bold` is for designs where the art is
meant to come forward and protects at 0.7 — still a large reduction, never off, because §6.D is a
rule about the face, not a preference.

Mode B's other half comes from §4's placement step, not here: "the subject may extend beyond the
photo region only when the administrator has configured that composition intentionally" becomes
`template_slots.bleed` (`false` default → the subject is clipped to the slot rect; `true` → the
placement rect is the bleed box and the clip rect stays the visible window), which is one number
computed in placement and one clip in the compositor.

## 9. Final rendering (§6 E)

- Composite at the template's own `width × height`, which the existing code already guarantees, so
  "natural proportions" is a property of the slot math (§4) rather than of the encode.
- Encode PNG and JPEG at the preset's `jpegQuality` when the composite has no transparent pixel;
  when it does, PNG only. Keep the smaller buffer, and keep PNG on a tie.
- `final` asset row records `content_type`, `width`, `height`, `bytes` (P1 already does) plus the
  `blend` decision block (§6.4, §10).

## 10. Failure handling and observability

- Any throw inside steps 1–7 (measure, mode, place, refine, match, shadow) is caught at the blend
  boundary and degrades to the P1 paste path with `render_params.blend = {applied: false, stage,
  error}`. A blend defect must never cost a contestant their portrait.
- A throw in the composite or the store remains a job failure on P1's ladder — that is unchanged,
  because there is no degraded render left to make.
- `photo_job_config_summary()` (P1's migration) gains nothing: the mode and preset are readable
  from the template row, and the applied record is readable from the asset row.
- Nothing in this layer calls a vendor, so no new failure mode reaches §12's moderation shape.

## 11. Migration

`supabase/migrations/20272200000000_contest_photo_blend.sql` — additive only, so `db push` applies
it forward and no existing row changes meaning:

```sql
ALTER TABLE public.contest_templates
  ADD COLUMN IF NOT EXISTS photo_mode   text NOT NULL DEFAULT 'auto'
    CHECK (photo_mode IN ('auto', 'background', 'photo_area')),
  ADD COLUMN IF NOT EXISTS blend_preset text NOT NULL DEFAULT 'natural'
    CHECK (blend_preset IN ('natural', 'studio', 'bold', 'off')),
  ADD COLUMN IF NOT EXISTS blend_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.template_slots
  ADD COLUMN IF NOT EXISTS image_url    text,
  ADD COLUMN IF NOT EXISTS anchor       text NOT NULL DEFAULT 'auto'
    CHECK (anchor IN ('auto', 'top', 'centre', 'bottom')),
  ADD COLUMN IF NOT EXISTS bleed        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS face_protect boolean NOT NULL DEFAULT true;
```

No new table, no new function, no asset-kind change (the blended subject stays an in-memory
intermediate, because §11 of the product spec enumerates stored assets as original, transparent,
final and variants — a fifth kind would be a new guarantee to keep). Because it collides with
nothing on `main` today, `check-migration-versions.sh` still passes; the renumber lesson from P1
is written into this file's header comment so a future newcomer moves, not this one.

## 12. Preset parameter table

Every number the code uses, so a review can argue with a value instead of with a word.

| key | natural | studio | bold |
|---|---|---|---|
| `subjectFill` (silhouette height as a fraction of slot height, Mode A) | 0.94 | 1.00 | 1.00 |
| `featherPx` (cap 0.4 % of slot min dim) | 1 | 2 | 2 |
| `speckleMinArea` (px) | 24 | 12 | 6 |
| `holeMaxArea` (px) | 24 | 40 | 60 |
| `lumaFraction` (how far toward the reference) | 0.45 | 0.65 | 0.8 |
| `lumaBias` | 0.97 | 1.00 | 1.03 |
| `gainMin` / `gainMax` | 0.92 / 1.08 | 0.88 / 1.12 | 0.80 / 1.25 |
| `tempMax` (per-channel gain deviation) | 0.04 | 0.06 | 0.09 |
| `contrastMax` | 0.06 | 0.10 | 0.14 |
| `dropOpacity` | 0.10 | 0.14 | 0.18 |
| `shadowBlurPx` | 12 | 18 | 24 |
| `shadowOffsetPx` | 10 | 14 | 18 |
| `contactOpacity` | 0.12 | 0.16 | 0.22 |
| `faceProtectStrength` | 0.92 | 0.85 | 0.70 |
| `shadow` (mode, §7) | `auto` | `auto` | `auto` |
| `jpegQuality` | 90 | 90 | 92 |

`blend_settings` overrides any key by name; unknown keys are ignored and a clamp violation is
clamped, not honoured. `off` skips §5–§8 entirely and renders exactly P1's paste.

## 13. Placement math (§5), in full

`measureSubject(bytes)` returns `{bbox, coverage, headTop, headBottom, shoulderY, face, widthAt,
silhouetteHeight}` from the alpha band alone.

`planPlacement(mode, slot, metrics, canvas)`:

1. Effective slot rect: `x, y, w = slot.width × slot.scale, h = slot.height × slot.scale`, clamped
   into the canvas (the existing clamp stays).
2. Mode A (`background`): fit = `contain`, so the subject's aspect ratio is preserved and nothing
   is cropped — §5's "without making contestants' photographs look unnaturally cropped". The
   subject is scaled so `silhouetteHeight` fills `h × preset.subjectFill` (0.94 natural / 1.0
   studio / 1.0 bold), then anchored by `anchor`: `bottom` puts the bbox's bottom edge on the slot
   bottom (a consistent ground line across contestants, which is what "consistent presentation"
   means for a lineup); `centre` centres; `top` puts `headTop` at 6 % of `h` from the slot top so
   a bust crop still shows hair. `auto` resolves to `bottom` when the silhouette reaches the bottom
   third of its own canvas and `centre` otherwise.
3. Mode B (`photo_area`): fit = `cover` of the slot rect with crop gravity derived from the
   metrics, never a fixed centre: the vertical offset keeps `headTop` inside the window with
   `headroom = 0.06 × h`, and if the silhouette is taller than the window at cover scale, the
   window is anchored on the face box rather than on the bbox centre. Horizontal offset keeps the
   face box centred in the window. With `bleed = true` the placement rect is the bleed box and the
   clip rect stays the window.
4. Rotation and opacity stay the slot's, applied after placement.
5. "Significant space around the subject" is handled by step 2's `silhouetteHeight` normalization:
   a waist-up photo with a lot of background and a tight close-up of the same person scale to the
   same head height in the frame, which is the consistency §5 asks for and what a plain `cover`
   resize cannot give.
6. Explicit offsets from a later editor (P4) arrive in `job.render_params` as
   `{xOffset, yOffset, scale}` and are applied last, on top of the plan — so P4's sliders do not
   need a second renderer either, and a param change re-keys the job by construction (`buildRunKey`
   already hashes `render_params`).

## 14. Testing

Unit, in `frontend-web/tests/unit/photo-jobs/blend/`, on synthetic images generated in the test
with sharp (a solid-magenta head-disc with a wider shoulder block on a green field, so geometry is
known exactly), with the alpha band read back through `sharp(...).raw()` and compared numerically.
Each acceptance rule below is a named test:

1. `measureSubject` recovers the planted bbox, coverage, head top, shoulder line and face box.
2. Defringe: a planted 1 px blended ring between subject and background comes back within tolerance
   of the subject colour and no nearer the background colour; the interior is byte-identical.
3. Speckles and holes: a planted 2×2 detached patch is removed, a planted 30×30 patch survives, a
   1 px hole inside the body is closed; silhouette area within tolerance.
4. Feather: `featherPx` cannot exceed 0.4 % of the slot's smaller dimension; the alpha at the
   interior is unchanged.
5. Light match: a subject measured at a known luminance against a known reference comes out within
   tolerance of `ref × bias`, the applied record contains the measured numbers, and the same code on
   a dark subject and a light subject produces different gains (the §6.B identity rule).
6. Skin-tone guard: hue angle shift stays under the bound implied by `tempMax`.
7. Shadow: pixels under the subject's own bbox centre keep the subject's colour (no glow, no
   outline); the band just below the silhouette is measurably darker by approximately `1 − op`; with
   `shadow: 'off'` the render equals the no-shadow render.
8. Face-safe: a foreground layer covering the whole canvas leaves the face box's centre pixel at
   the subject value while a pixel below the shoulders is allowed to be the overlay's.
9. Placement: a 4:5 subject in a square slot at Mode A occupies exactly `w × 0.8`; the same subject
   and a wide 16:9 subject in a Mode B slot both have their planted head bands at the same y and
   both have the head inside the window; `bleed` changes the clip rect but never the placement.
10. Encode: the assertion is the *rule*, not a prediction of the winner — the test encodes both
    itself and checks that the stored buffer is the smaller and `content_type` names it (which is
    what makes the test survive a libvips upgrade). Separately: a composite containing any
    transparent pixel is PNG with its alpha preserved, and a 900×1100 noisy opaque photograph is
    JPEG, because noise at that size is the one input where q90 cannot lose to a deflate.
11. Runner integration: a job whose template resolves `blend_preset: 'natural'` stores a `final`
    with `render_params.blend.applied = true` and still stores `original` and `transparent` rows
    untouched; a blend that throws degrades to P1's paste with `applied = false` and the job still
    reaches `ready`; `blend_preset: 'off'` renders identically to today's `main`.
12. The §11 rule "never overwrite the original" is re-proved on the merged chain: the P1
    `reject_contest_photo_asset_mutation` trigger still refuses an update to an `original` row, and
    the new migration's replay is added to the existing live-DB check.

No golden-image assertions: they fail on a libvips upgrade, they cannot be reviewed by eye in a PR,
and every claim §6 actually makes is a numeric relation about a named region, which is what these
tests assert instead.

## 15. Prerequisites that are not mine to satisfy

1. P1's list stands and is unchanged: server-side `CLOUDINARY_*` for extraction and moderation,
   `R2_PUBLIC_BASE_URL` (or presigning) for stored output, and the migration applied through the
   normal release path.
2. A *visual* acceptance pass on real contestant photographs needs a template published with a
   non-`off` preset and a human looking at the result. This layer can and will prove every numeric
   property above without either; it cannot prove "this looks like a campaign shoot" from a
   synthetic head-disc, and the plan will not claim otherwise.
3. P3's admin studio is what makes `photo_mode`, `blend_preset`, `blend_settings`, `image_url` and
   the slot placement fields *reachable by an operator*. Until it exists they are defaults, and the
   `'auto'` inference in §3 is what carries real templates.

## 16. Out of scope here

The admin template studio, its live preview, draft/publish and versioning UI (§3 admin config, §8 —
P3). The contestant preview-and-adjust editor and `USE THIS PHOTO` (§7 — P4; P2 provides the
placement math it manipulates and the `render_params` fields it writes). Surfacing the `final`
composite on listing cards, profiles, landing pages, galleries, featured sections, leaderboards,
sharing previews and mobile (§9, §13, §15 — P4). Regeneration UX when a template is republished.
Background removal quality itself (§4 — the provider seam, unchanged).
