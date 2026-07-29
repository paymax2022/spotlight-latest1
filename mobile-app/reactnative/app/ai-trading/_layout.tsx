// AI Trading module — a linear Stack sub-flow inside the super app. Registered as
// a route group; screens are pushed from the module entry (index).
import { Stack } from 'expo-router';

export default function AiTradingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="kyc" />
      <Stack.Screen name="fund" />
      <Stack.Screen name="redeem" />
    </Stack>
  );
}
