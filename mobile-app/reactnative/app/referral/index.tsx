import { Redirect } from 'expo-router';

// Entering /referral lands on the Earn-hub Home tab.
export default function ReferralIndex() {
  return <Redirect href="/referral/(tabs)/home" />;
}
