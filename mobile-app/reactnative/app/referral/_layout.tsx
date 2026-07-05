import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

// Referral (Earn hub) stack. The (tabs) group is the home of the 5-tab nav;
// onboarding/account/invite live as pushed screens over it. Other referral
// agents (RM2/RM3) add their screens to the matching subfolders.
export default function ReferralLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />

      {/* Onboarding (M-ONB-*) */}
      <Stack.Screen name="onboarding/hub-entry" options={{ animation: 'fade' }} />
      <Stack.Screen name="onboarding/how-earning-works" />
      <Stack.Screen name="onboarding/disclosure-terms" />
      <Stack.Screen name="onboarding/contacts-consent" />
      <Stack.Screen name="onboarding/code-entry" />
      <Stack.Screen name="onboarding/role-switcher" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="onboarding/become-ambassador" />
      <Stack.Screen name="onboarding/become-agent" />
      <Stack.Screen name="onboarding/become-merchant" />
      <Stack.Screen name="onboarding/step-up-verify" />

      {/* Late code-claim (M-INV-10) */}
      <Stack.Screen name="invite/claim-code" />

      {/* Account / Trust / Notifications (M-ACC-* / M-NOT-01) */}
      <Stack.Screen name="account/verification-fraud-status" />
      <Stack.Screen name="account/report-abuse" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="account/earnings-tax" />
      <Stack.Screen name="account/settings" />
      <Stack.Screen name="account/help-support" />
      <Stack.Screen name="account/responsible-earning" />
      <Stack.Screen name="account/notifications" />
    </Stack>
  );
}
