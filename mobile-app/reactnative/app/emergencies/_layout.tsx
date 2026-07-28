import { Stack } from 'expo-router';
export default function EmergenciesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="report" />
    </Stack>
  );
}
