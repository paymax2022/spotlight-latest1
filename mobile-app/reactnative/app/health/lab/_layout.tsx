import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Laboratory vertical stack (HEALTH-BUILD Phase 2). Mounts under the shared
 * health platform (app/health/_layout.tsx). Customer screens live here;
 * provider screens under ./provider/*, phlebotomist under ./phlebotomist/*.
 * Legacy app/laboratory is untouched.
 */
export default function LabLayout() {
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
      <Stack.Screen name="catalog" />
      <Stack.Screen name="test/[id]" />
      <Stack.Screen name="packages" />
      <Stack.Screen name="lab-select" />
      <Stack.Screen name="book" />
      <Stack.Screen name="home-collection" />
      <Stack.Screen name="checkout" />
      <Stack.Screen name="phlebotomist-tracking" />
      <Stack.Screen name="collection-confirm" />
      <Stack.Screen name="test-status" />
      <Stack.Screen name="results/[id]" />
      <Stack.Screen name="results-interpretation" />
      <Stack.Screen name="share-results" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="reports" />
      <Stack.Screen name="reorder" />
      <Stack.Screen name="ratings" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Provider (lab) */}
      <Stack.Screen name="provider/onboarding" />
      <Stack.Screen name="provider/catalog" />
      <Stack.Screen name="provider/orders" />
      <Stack.Screen name="provider/accessioning" />
      <Stack.Screen name="provider/result-entry" />
      <Stack.Screen name="provider/result-release" />
      <Stack.Screen name="provider/earnings" />
      <Stack.Screen name="provider/reviews" />

      {/* Phlebotomist */}
      <Stack.Screen name="phlebotomist/onboarding" />
      <Stack.Screen name="phlebotomist/assignments" />
      <Stack.Screen name="phlebotomist/collection-checklist" />
      <Stack.Screen name="phlebotomist/chain-of-custody" />
      <Stack.Screen name="phlebotomist/drop-off" />
    </Stack>
  );
}
