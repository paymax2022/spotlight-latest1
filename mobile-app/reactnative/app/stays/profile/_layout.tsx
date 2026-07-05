import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/** Paymax Stays (SM2) — profile / saved guests / wallet overview (PRD §17 G). */
export default function StaysProfileLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="saved-guests" />
      <Stack.Screen name="wallet-overview" />
    </Stack>
  );
}
