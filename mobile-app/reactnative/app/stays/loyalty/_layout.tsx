import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/** Paymax Stays (SM2) — loyalty segment (PRD §16 / §17 G, screen 52). */
export default function StaysLoyaltyLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
    </Stack>
  );
}
