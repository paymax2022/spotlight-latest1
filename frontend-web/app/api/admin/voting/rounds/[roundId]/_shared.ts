// Shared between publish-results/route.ts and results/route.ts. Kept out of
// the route files themselves — Next.js App Router route modules should only
// export HTTP method handlers (plus its own reserved config exports), not
// arbitrary helpers.
export const TIE_BREAK_RULE = 'total_confirmed_votes DESC, paid_votes DESC, last_vote_at ASC';
