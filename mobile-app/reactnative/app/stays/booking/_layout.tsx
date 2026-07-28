import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Paymax Stays (SM2) — confirmation/voucher segment (PRD §17 E, screens 34–36).
 * `confirmed` is the success target after a successful book; `voucher` is the
 * downloadable/shareable e-receipt. Owned by SM2.
 */
export default function StaysBookingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="confirmed" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="voucher" />
    </Stack>
  );
}
