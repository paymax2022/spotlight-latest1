import { Stack } from 'expo-router';
export default function FacilitiesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="book" />
    </Stack>
  );
}
