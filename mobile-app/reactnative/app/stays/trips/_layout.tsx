import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Paymax Stays (SM2) — trips / confirmation / trip-management segment (PRD §17 E).
 * Owned by SM2; registered separately from SM1's app/stays/_layout.tsx.
 */
export default function StaysTripsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="upcoming" />
      <Stack.Screen name="past" />
      <Stack.Screen name="cancelled" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="modify" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="cancel" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="refund-status" />
    </Stack>
  );
}
