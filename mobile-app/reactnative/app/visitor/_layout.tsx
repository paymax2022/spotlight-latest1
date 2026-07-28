import { Stack } from 'expo-router';

export default function VisitorLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create" />
      <Stack.Screen name="code/[id]" />
      <Stack.Screen name="extend/[id]" />
      <Stack.Screen name="active" />
      <Stack.Screen name="history" />
      <Stack.Screen name="restricted" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="analytics" />
      <Stack.Screen name="event-guests" />
      <Stack.Screen name="restriction/proof" />
      <Stack.Screen name="restriction/appeal" />
    </Stack>
  );
}
