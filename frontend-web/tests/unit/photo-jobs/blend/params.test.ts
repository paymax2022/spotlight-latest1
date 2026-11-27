/**
 * P2 Task 2 — the preset table and its hard ceilings (spec §12).
 *
 * Two properties matter here and neither is about looks. First, the numbers are
 * the spec's, verbatim: a render that quietly drifts to a softer feather is
 * invisible in review and impossible to attribute later. Second, an override
 * may only ever narrow a bound — the admin UI in P3 will write `blend_settings`
 * straight from a form, and the renderer must not be the place where a typo
 * becomes a 50 px feather or a JPEG at quality 10.
 */
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
