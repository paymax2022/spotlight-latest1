import { Redirect } from 'expo-router';

// Paymax Connect entry. The full 5-tab experience (Discover · Live · Create ·
// Inbox · Me) lives in the (tabs) group; this entry redirects into it.
// Onboarding/verification gating is enforced inside the tabs + money flows.
export default function ConnectEntry() {
  return <Redirect href="/connect/(tabs)/discover" />;
}
