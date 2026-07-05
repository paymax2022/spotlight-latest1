// Discover tab root (PRD §5 / §10.2). This IS the discovery entry point: it
// renders the real swipe/card stack (app/connect/discover/stack.tsx) which owns
// the mode toggle, filters, likes-you and the swipe → match flow. Kept as a thin
// re-export so /connect/(tabs)/discover and /connect/discover/stack render the
// same working surface.
export { default } from '../discover/stack';
