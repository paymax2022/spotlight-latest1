import { Stack } from 'expo-router';

export default function MerchantLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="modules" />
      <Stack.Screen name="types" />
      <Stack.Screen name="apply/[typeId]" />
      <Stack.Screen name="application/[id]" />
    </Stack>
  );
}
