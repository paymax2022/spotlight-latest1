import { Stack } from 'expo-router';

export default function WalletLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="add" />
      <Stack.Screen name="send" />
      <Stack.Screen name="withdraw" />
      <Stack.Screen name="transaction/[id]" />
    </Stack>
  );
}
