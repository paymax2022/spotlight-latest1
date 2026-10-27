// The events footer: four tabs in a fixed order. This is the single source of
// that order and of the route each tab opens. It is pure (no icons, no
// React Native imports) so a unit test can check it against the route files
// under app/events/; the screens attach an icon and label to each href.
export const EVENTS_TAB_HREFS = [
  '/events/following',
  '/events',
  '/events/my-tickets',
  '/events/organiser',
] as const;

export type EventsTabHref = (typeof EVENTS_TAB_HREFS)[number];
