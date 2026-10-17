// Pure like/follow toggle helpers (events-social). No imports: the optimistic
// hooks in hooks.ts use these to apply a change before the call returns and to
// reverse it if the call fails. They never mutate their input and the count
// never goes below 0.

export interface ToggleState {
  liked: boolean;
  count: number;
}

function applyToggle(state: ToggleState, next: boolean): ToggleState {
  // Only a real flip moves the count; repeating the current state is a no-op,
  // which matches the idempotent server writes.
  if (state.liked === next) return { liked: next, count: Math.max(0, state.count) };
  return { liked: next, count: Math.max(0, state.count + (next ? 1 : -1)) };
}

export function applyLikeToggle(state: ToggleState, next: boolean): ToggleState {
  return applyToggle(state, next);
}

// The follow state shares the { liked, count } shape: `liked` is "following"
// and `count` is the follower count.
export function applyFollowToggle(state: ToggleState, next: boolean): ToggleState {
  return applyToggle(state, next);
}

// Following feed paging. Mirrors the server (followingPage in the Go handler):
// limit is an integer 1..100, offset an integer >= 0, anything else is rejected
// before a request is sent.
export const FOLLOWING_LIMIT_MAX = 100;

export function checkFollowingPage(limit: number, offset: number): { limit: number; offset: number } {
  if (!Number.isInteger(limit) || limit < 1 || limit > FOLLOWING_LIMIT_MAX) {
    throw new Error(`limit must be a whole number between 1 and ${FOLLOWING_LIMIT_MAX}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a whole number of 0 or more');
  }
  return { limit, offset };
}
