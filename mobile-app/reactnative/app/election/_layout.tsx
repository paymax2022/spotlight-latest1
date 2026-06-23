import { Stack } from 'expo-router';

export default function ElectionLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="list" />
      <Stack.Screen name="candidate/[id]" />
      <Stack.Screen name="receipt" />
      <Stack.Screen name="observer" />
      <Stack.Screen name="admin/setup" />
    </Stack>
  );
}
