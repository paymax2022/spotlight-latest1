import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Paymax AI Symptom Checker stack (mock-first). Mounts under the shared health
 * platform (app/health/_layout.tsx). Triage = navigation guidance only, never a
 * diagnosis (SC-1). The Emergency screen is presented full-screen.
 */
export default function TriageLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Entry: profile picker + consent + medical-disclaimer gate */}
      <Stack.Screen name="index" />
      {/* Symptom intake: free text + body-map + common symptoms */}
      <Stack.Screen name="intake" />
      {/* Adaptive interview loop */}
      <Stack.Screen name="interview" />
      {/* 5-level disposition result */}
      <Stack.Screen name="result" />
      {/* Referral checkout (wallet held-payment) */}
      <Stack.Screen name="checkout" />
      {/* Save-to-records confirmation + follow-up + feedback */}
      <Stack.Screen name="saved" />
      {/* Full-screen EMERGENCY / red-flag (SC-8) — presented over everything */}
      <Stack.Screen
        name="emergency"
        options={{ animation: 'fade', presentation: 'fullScreenModal', gestureEnabled: false }}
      />
    </Stack>
  );
}
