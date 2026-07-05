import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Veterinary vertical stack (HEALTH-BUILD Phase 3). Mounts under the shared
 * health platform (app/health/_layout.tsx). Customer screens live here;
 * provider screens under ./provider/*. Legacy app/(doctor)/vet is untouched.
 */
export default function VetLayout() {
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
      <Stack.Screen name="pet-add" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="pet/[id]" />
      <Stack.Screen name="find-vet" />
      <Stack.Screen name="vet/[id]" />
      <Stack.Screen name="triage" />
      <Stack.Screen name="book" />
      <Stack.Screen name="checkout" />
      <Stack.Screen name="teleconsult-lobby" />
      <Stack.Screen name="teleconsult" options={{ gestureEnabled: false }} />
      <Stack.Screen name="consult-summary" />
      <Stack.Screen name="eprescription/[id]" />
      <Stack.Screen name="order-lab" />
      <Stack.Screen name="vaccination-scheduler" />
      <Stack.Screen name="home-visit-tracking" />
      <Stack.Screen name="follow-up" />
      <Stack.Screen name="appointments" />
      <Stack.Screen name="emergency-sos" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="ratings" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="pet-meds" />

      {/* Provider */}
      <Stack.Screen name="provider/onboarding" />
      <Stack.Screen name="provider/profile" />
      <Stack.Screen name="provider/availability" />
      <Stack.Screen name="provider/requests" />
      <Stack.Screen name="provider/pet-chart" />
      <Stack.Screen name="provider/teleconsult" options={{ gestureEnabled: false }} />
      <Stack.Screen name="provider/soap-notes" />
      <Stack.Screen name="provider/eprescribe" />
      <Stack.Screen name="provider/order-lab" />
      <Stack.Screen name="provider/home-nav" />
      <Stack.Screen name="provider/earnings" />
      <Stack.Screen name="provider/reviews" />
      <Stack.Screen name="provider/referral" />
    </Stack>
  );
}
