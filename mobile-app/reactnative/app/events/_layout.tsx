import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function EventsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="my-tickets" />
      <Stack.Screen name="ticket/[id]" />

      {/* Checkout */}
      <Stack.Screen name="checkout/tiers" />
      <Stack.Screen name="checkout/review" />
      <Stack.Screen name="checkout/success" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Organiser */}
      <Stack.Screen name="organiser/create" />
      <Stack.Screen name="organiser/dashboard" />
      <Stack.Screen name="organiser/attendees" />

      {/* Steward */}
      <Stack.Screen name="steward/scan" />

      {/* Cashless event wallet */}
      <Stack.Screen name="wallet/top-up" />
      <Stack.Screen name="wallet/tap-pay" />
      <Stack.Screen name="wallet/history" />
      <Stack.Screen name="wallet/withdraw" />
      <Stack.Screen name="wallet/venue-map" />
    </Stack>
  );
}
