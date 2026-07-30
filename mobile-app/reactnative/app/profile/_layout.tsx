import { Stack } from 'expo-router';

export default function ProfileStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="business/index" />
      <Stack.Screen name="business/verify" />
      <Stack.Screen name="business/register/index" />
    </Stack>
  );
}
