import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function InvestLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="discover" />
      <Stack.Screen name="stock/[symbol]" />
      <Stack.Screen name="buy" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="sell" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="portfolio" />
      <Stack.Screen name="orders" />
      <Stack.Screen name="wallet" />
      <Stack.Screen name="security/pin" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
    </Stack>
  );
}
