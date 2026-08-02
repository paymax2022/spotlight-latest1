// ── Academy bookmarks — pure list operations ─────────────────────────────────
// Bookmarks are keyed by their canonical `href` (the lesson/topic/past-question
// route). Pure + testable; the mock/live API layer wraps these with the module
// bookmark list and the offline sync.

import type { Bookmark } from './types';

/** The bookmark for a given canonical href, if the learner has one. */
export function findBookmarkByHref(list: readonly Bookmark[], href: string): Bookmark | undefined {
  return list.find((b) => b.href === href);
}

/**
 * Insert (or replace) a bookmark, newest first, deduped by href — so tapping the
 * bookmark control twice can never create two rows for the same lesson.
 * Pure: does not mutate the input list.
 */
export function upsertBookmark(list: readonly Bookmark[], bm: Bookmark): Bookmark[] {
  return [bm, ...list.filter((b) => b.href !== bm.href)];
}
