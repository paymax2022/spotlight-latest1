/**
 * The blend layer's parameter surface (spec §12).
 *
 * One table, one bound list, one resolver. Everything downstream — the edge
 * pass, the light match, the grounding, the encoder — takes a `BlendParams`
 * and never re-reads a preset string, so the question "what number did this
 * render actually use?" has exactly one answer and it is computable from the
 * template row plus this file.
 *
 * Two rules the shape of this module encodes:
 *
 * - An override may narrow a bound but never pass it. `blend_settings` is
 *   written by an admin form in P3 and read here; if a ceiling lived at the
 *   point of use, a typo would be a rendering policy instead of a clamped
 *   number. The clamps are the widest value any preset ships with, plus the
 *   §5.3 / §6.3 / §7 / §9 limits that are tighter than any preset.
 * - Nothing here throws. A template whose preset column contains a value from
 *   a future release, a NULL, or the string "vivid" renders with `natural`
 *   numbers, because a failed job is a worse outcome for a contestant than a
 *   conservatively blended one.
 */

export type BlendPresetName = 'natural' | 'studio' | 'bold' | 'off';
export type ShadowMode = 'auto' | 'on' | 'off';

export interface BlendParams {
  preset: BlendPresetName;
  subjectFill: number;
  featherPx: number;
  speckleMinArea: number;
  holeMaxArea: number;
  lumaFraction: number;
  lumaBias: number;
  gainMin: number;
  gainMax: number;
  tempMax: number;
  contrastMax: number;
  dropOpacity: number;
  shadowBlurPx: number;
  shadowOffsetPx: number;
  contactOpacity: number;
  faceProtectStrength: number;
  shadow: ShadowMode;
  jpegQuality: number;
}

/**
 * The §12 table, verbatim. Every number a render may use lives here.
 *
 * Exported (P3 Task 8) so the admin write gate can validate against this table
 * instead of a copy: `src/server/template-studio/authoring.ts` refuses an unknown
 * key and clamps an out-of-bound one using these exact entries, which is the only
 * way "the number the form stored" and "the number the render used" stay one
 * number. Contents unchanged from §12.
 */
export const PRESETS: Record<BlendPresetName, BlendParams> = {
  natural: {
    preset: 'natural', subjectFill: 0.94, featherPx: 1, speckleMinArea: 24, holeMaxArea: 24,
    lumaFraction: 0.45, lumaBias: 0.97, gainMin: 0.92, gainMax: 1.08, tempMax: 0.04, contrastMax: 0.06,
    dropOpacity: 0.10, shadowBlurPx: 12, shadowOffsetPx: 10, contactOpacity: 0.12,
    faceProtectStrength: 0.92, shadow: 'auto', jpegQuality: 90,
  },
  studio: {
    preset: 'studio', subjectFill: 1.00, featherPx: 2, speckleMinArea: 12, holeMaxArea: 40,
    lumaFraction: 0.65, lumaBias: 1.00, gainMin: 0.88, gainMax: 1.12, tempMax: 0.06, contrastMax: 0.10,
    dropOpacity: 0.14, shadowBlurPx: 18, shadowOffsetPx: 14, contactOpacity: 0.16,
    faceProtectStrength: 0.85, shadow: 'auto', jpegQuality: 90,
  },
  bold: {
    preset: 'bold', subjectFill: 1.00, featherPx: 2, speckleMinArea: 6, holeMaxArea: 60,
    lumaFraction: 0.80, lumaBias: 1.03, gainMin: 0.80, gainMax: 1.25, tempMax: 0.09, contrastMax: 0.14,
    dropOpacity: 0.18, shadowBlurPx: 24, shadowOffsetPx: 18, contactOpacity: 0.22,
    faceProtectStrength: 0.70, shadow: 'auto', jpegQuality: 92,
  },
  // 'off' is not a look — it is the absence of the engine, so every number is
  // the identity value and the runner short-circuits before calling it. The
  // jpegQuality stays at natural's 90 because P1's compositor encoded PNG and
  // §9's smaller-of rule still needs a quality number to compare against.
  off: {
    preset: 'off', subjectFill: 1, featherPx: 0, speckleMinArea: 0, holeMaxArea: 0,
    lumaFraction: 0, lumaBias: 1, gainMin: 1, gainMax: 1, tempMax: 0, contrastMax: 0,
    dropOpacity: 0, shadowBlurPx: 0, shadowOffsetPx: 0, contactOpacity: 0,
    faceProtectStrength: 0, shadow: 'off', jpegQuality: 90,
  },
};

/**
 * Hard ceilings (§5.3, §6.3, §7, §9): an override may narrow these, never pass them.
 *
 * The studio console renders one slider per entry and `template-studio/authoring.ts`
 * clamps writes to these, both by importing this object rather than restating it —
 * a second copy is how a form ends up offering a value the renderer silently ignores.
 */
export const BOUNDS: Partial<Record<keyof BlendParams, [number, number]>> = {
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
};

/** The three shadow modes. Exported for the same reason as `BOUNDS`. */
export const SHADOW_MODES: readonly ShadowMode[] = ['auto', 'on', 'off'];

function clampTo(key: keyof BlendParams, value: number): number {
  const bound = BOUNDS[key];
  if (!bound) return value;
  return Math.min(bound[1], Math.max(bound[0], value));
}

/**
 * Resolve the parameters one render will use.
 *
 * `presetName` comes from `contest_templates.blend_preset` and `overrides` from
 * `blend_settings` — both are database text, so both are typed `unknown` here
 * and validated rather than trusted. An override is honoured only when it is
 * a number (or, for `shadow`, one of the three mode strings) and only within
 * its bound; anything else is dropped, which keeps a malformed JSON column from
 * changing a render at all.
 */
export function resolveBlendParams(presetName: string, overrides?: unknown): BlendParams {
  const base = PRESETS[(presetName ?? '') as BlendPresetName] ?? PRESETS.natural;
  const out: BlendParams = { ...base };
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return out;

  for (const [key, raw] of Object.entries(overrides as Record<string, unknown>)) {
    const paramKey = key as keyof BlendParams;
    if (paramKey === 'preset') continue; // the preset is identity, not a knob
    if (paramKey === 'shadow') {
      if (SHADOW_MODES.includes(raw as ShadowMode)) out.shadow = raw as ShadowMode;
      continue;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    if (!(paramKey in BOUNDS)) continue; // unknown key, or one that is not a number
    out[paramKey] = clampTo(paramKey, raw) as never;
  }
  return out;
}

/** True when the render must be byte-for-byte P1's paste. */
export function isBlendDisabled(p: BlendParams): boolean {
  return p.preset === 'off';
}
