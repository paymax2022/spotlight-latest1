import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/** Paymax Stays (SM2) — reviews segment (PRD §17 G, screens 49–50). */
export default function StaysReviewsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="write" />
      <Stack.Screen name="mine" />
    </Stack>
  );
}
