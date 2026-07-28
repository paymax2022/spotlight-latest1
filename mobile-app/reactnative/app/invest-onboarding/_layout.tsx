import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Paymax Invest · Onboarding stack — the compliance gate users clear before
 * trading. Mirrors the crypto module's navigation conventions (slide-from-right
 * default; success/complete screens lock the gesture and fade in). The whole
 * surface sits behind the `invest_onboarding` feature flag.
 */
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Intro & gate */}
      <Stack.Screen name="index" />
      <Stack.Screen name="eligibility" />

      {/* KYC flow */}
      <Stack.Screen name="kyc/status" />
      <Stack.Screen name="kyc/personal" />
      <Stack.Screen name="kyc/identity" />
      <Stack.Screen name="kyc/selfie" />
      <Stack.Screen name="kyc/review" />
      <Stack.Screen name="kyc/submitted" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Suitability flow */}
      <Stack.Screen name="suitability/index" />
      <Stack.Screen name="suitability/questions" />
      <Stack.Screen name="suitability/result" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Agreements */}
      <Stack.Screen name="agreements/index" />

      {/* Done */}
      <Stack.Screen name="complete" options={{ gestureEnabled: false, animation: 'fade' }} />
    </Stack>
  );
}
