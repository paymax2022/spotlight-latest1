import React from 'react';
import { Users, Compass, Ticket, LayoutDashboard } from 'lucide-react-native';
import ModuleTabBar, { type ModuleTab } from '@/components/ModuleTabBar';
import { EVENTS_TAB_HREFS, type EventsTabHref } from '../tabs';

// events-social flag: exactly the string 'true' turns it on; default off.
export const EVENTS_SOCIAL = process.env.EXPO_PUBLIC_EVENTS_SOCIAL === 'true';

// Label, icon and any extra screens that belong to each tab. The ORDER is not
// set here: it comes from EVENTS_TAB_HREFS, and Record<EventsTabHref, ...> makes
// the compiler reject a tab that is added to or removed from that list here.
const TAB_META: Record<EventsTabHref, Omit<ModuleTab, 'href'>> = {
  '/events/following': { label: 'Following', icon: Users },
  '/events': { label: 'Discover', icon: Compass },
  '/events/my-tickets': { label: 'My tickets', icon: Ticket },
  // /events/organiser is a redirect to the dashboard, so the dashboard is the
  // screen the user is actually on when this tab is active.
  '/events/organiser': { label: 'Organiser', icon: LayoutDashboard, matchPaths: ['/events/organiser/dashboard'] },
};

const TABS: readonly ModuleTab[] = EVENTS_TAB_HREFS.map((href) => ({ href, ...TAB_META[href] }));

// The events footer. Render it as the last child of a tab screen only (events
// index, my-tickets, following, organiser dashboard) and never on a pushed
// detail screen. With the flag off it draws nothing.
export default function EventsTabBar() {
  if (!EVENTS_SOCIAL) return null;
  return <ModuleTabBar tabs={TABS} />;
}
