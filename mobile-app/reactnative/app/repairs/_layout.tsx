import { Stack } from 'expo-router';
export default function RepairsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="report" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
