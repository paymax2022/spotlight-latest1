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

/**
 * Whether the pinned section tabs should show: only once the scroll position
 * has reached the first (measured) section. False when nothing is measured.
 */
export function menuTabsVisible(scrollY: number, offsets: readonly number[], slack: number): boolean {
  const first = offsets.find((y) => typeof y === 'number' && Number.isFinite(y));
  if (first === undefined) return false;
  return scrollY >= first - slack;
}

/**
 * Y of a section inside the scroll CONTENT, from window-relative measurements:
 * (section window y) - (scroll viewport window y) + (current scroll offset).
 * Scroll-invariant, so it is correct however far the list has scrolled.
 */
export function contentOffsetFromWindow(sectionWindowY: number, viewportWindowY: number, scrollY: number): number {
  return sectionWindowY - viewportWindowY + scrollY;
}
