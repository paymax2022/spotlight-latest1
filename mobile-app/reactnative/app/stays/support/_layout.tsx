import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Paymax Stays (SM2) — communication & support segment (PRD §17 F, screens 44–48).
 * Owned by SM2.
 */
export default function StaysSupportLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="chat" />
      <Stack.Screen name="help" />
      <Stack.Screen name="contact" />
      <Stack.Screen name="dispute" />
      <Stack.Screen name="notifications" />
    </Stack>
  );
}
