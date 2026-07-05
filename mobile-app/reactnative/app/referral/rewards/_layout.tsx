import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

// Direct Referral Rewards stack (PRD §5) — single-level, purchase-triggered
// revenue share. Distinct from the legacy ambassador/agent screens elsewhere
// under app/referral/*. All screens are headerless (each renders its own
// RewardHeader) except the celebration/upgrade moments which come in modal.
export default function ReferralRewardsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="share" />
      <Stack.Screen name="referrals" />
      <Stack.Screen name="earnings" />
      <Stack.Screen name="tiers" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="milestone" options={{ animation: 'fade', presentation: 'transparentModal' }} />
      <Stack.Screen name="tier-upgraded" options={{ animation: 'fade', presentation: 'transparentModal' }} />
    </Stack>
  );
}
