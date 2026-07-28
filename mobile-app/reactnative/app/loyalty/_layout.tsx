import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function LoyaltyLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="earn-history" />
      <Stack.Screen name="catalog" />
      <Stack.Screen name="redeem" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="tier-benefits" />
      <Stack.Screen name="referral" />
      <Stack.Screen name="progress" />
      <Stack.Screen name="how-it-works" />
    </Stack>
  );
}
