import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Pharmacy vertical stack (HEALTH-BUILD Phase 1). Mounts under the shared health
 * platform (app/health/_layout.tsx). Customer screens live here; provider screens
 * under ./provider/*. Legacy app/pharmacy is untouched.
 */
export default function PharmacyLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Customer */}
      <Stack.Screen name="index" />
      <Stack.Screen name="upload-rx" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="rx-status" />
      <Stack.Screen name="search" />
      <Stack.Screen name="product/[id]" />
      <Stack.Screen name="cart" />
      <Stack.Screen name="pharmacy-select" />
      <Stack.Screen name="checkout" />
      <Stack.Screen name="delivery-tracking" />
      <Stack.Screen name="pickup-code" />
      <Stack.Screen name="pharmacist-consult" />
      <Stack.Screen name="medication-list" />
      <Stack.Screen name="refills" />
      <Stack.Screen name="rx-wallet" />
      <Stack.Screen name="orders" />
      <Stack.Screen name="reorder" />
      <Stack.Screen name="ratings" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="bnpl" />

      {/* Symptom-based search (addon PRD) — gated by PHARMACY_SYMPTOM_SEARCH_ENABLED */}
      <Stack.Screen name="symptom/index" />
      <Stack.Screen name="symptom/refine" />
      <Stack.Screen name="symptom/results" />
      <Stack.Screen name="symptom/escalation" options={{ gestureEnabled: false }} />

      {/* Provider */}
      <Stack.Screen name="provider/onboarding" />
      <Stack.Screen name="provider/catalog" />
      <Stack.Screen name="provider/orders" />
      <Stack.Screen name="provider/rx-verify" />
      <Stack.Screen name="provider/controlled-log" />
      <Stack.Screen name="provider/dispense" />
      <Stack.Screen name="provider/handoff" />
      <Stack.Screen name="provider/consult" />
      <Stack.Screen name="provider/stock-alerts" />
      <Stack.Screen name="provider/earnings" />
      <Stack.Screen name="provider/reviews" />
    </Stack>
  );
}
