/**
 * One separable box blur over a single 8-bit band, shared by the two passes that
 * need it: §5.3's feather (alpha only, radius ≤ 2) and §7's shadows (the
 * silhouette band, radius up to ~15).
 *
 * It is written by hand rather than through libvips for the reason §5.3 gives —
 * a blur that touches only this band cannot smudge colour — and because the
 * caller already holds a typed array: handing libvips a one-channel raw buffer,
 * blurring it and reading it back costs a round trip and the channel-count
 * bookkeeping §2 warns about, for an operation that is two linear sweeps.
 *
 * Out-of-image samples read as zero, so a blur near the frame edge darkens
 * rather than duplicating the edge: a shadow's fade is a fact about the image it
 * was cut from, and a feather must not gain opacity where the picture ends.
 */

/**
 * One separable box blur: horizontal sweep then vertical, window `2r + 1`.
 * A single pass has variance `(w² − 1) / 12`.
 */
export function boxBlurBand(band: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return band;
  const horizontal = new Uint8Array(band.length);
  const vertical = new Uint8Array(band.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const nx = x + k;
        sum += nx >= 0 && nx < width ? band[row + nx] : 0;
      }
      horizontal[row + x] = Math.round(sum / span);
    }
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const ny = y + k;
        sum += ny >= 0 && ny < height ? horizontal[ny * width + x] : 0;
      }
      vertical[row + x] = Math.round(sum / span);
    }
  }
  return vertical;
}

/**
 * Two passes, which is what makes a box blur a shadow rather than a smudge: one
 * pass has flat tops and hard shoulders, and stacked on itself it is within a
 * few percent of a Gaussian. Variance doubles, so `σ² = (w² − 1) / 6`.
 */
export function boxBlurBandTwice(band: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return band;
  return boxBlurBand(boxBlurBand(band, width, height, radius), width, height, radius);
}

/**
 * The box radius whose two passes come out at standard deviation `sigma`.
 *
 * §7 and §12 name a shadow blur in pixels ("12 / 18 / 24"), and a single box of
 * that width would give σ ≈ blur/3.5 — a tight, dark edge that reads as a
 * sticker. Inverting the two-pass variance above turns the spec's number into a
 * radius: `w = √(6σ² + 1)`, `r = ⌊w / 2⌋`, so σ = 6 lands on r = 7 and σ ≈ 6.04.
 */
export function radiusForSigma(sigma: number): number {
  if (sigma <= 0) return 0;
  return Math.max(1, Math.floor(Math.sqrt(6 * sigma * sigma + 1) / 2));
}
