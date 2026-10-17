import React from 'react';
import { Redirect } from 'expo-router';
import { organiserIndexTarget } from '@/features/events/organiser';

// events-social flag: exactly the string 'true' turns it on; default off.
const EVENTS_SOCIAL = process.env.EXPO_PUBLIC_EVENTS_SOCIAL === 'true';

// The app has no organiser role on the client (the dashboard itself shows an
// empty state to anyone with no events), so with the flag on the index always
// goes to the dashboard. With the flag off it goes to the events list.
export default function OrganiserIndex() {
  return <Redirect href={organiserIndexTarget(EVENTS_SOCIAL)} />;
}
