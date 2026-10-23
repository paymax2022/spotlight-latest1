/**
 * Index of the section the user is currently reading: the last section whose
 * measured y offset is at or above `scrollY + slack`. Before the first section
 * it is 0; with no offsets it is -1. Unmeasured entries are skipped.
 */
export function activeSectionIndex(scrollY: number, offsets: readonly number[], slack: number): number {
  if (offsets.length === 0) return -1;
  let active = 0;
  for (let i = 0; i < offsets.length; i++) {
    const y = offsets[i];
    if (typeof y !== 'number' || !Number.isFinite(y)) continue;
    if (y <= scrollY + slack) active = i;
  }
  return active;
}
