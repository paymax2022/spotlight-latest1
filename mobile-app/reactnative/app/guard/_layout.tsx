import { Stack } from 'expo-router';

export default function GuardLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="scan" />
      <Stack.Screen name="confirm/[code]" />
      <Stack.Screen name="expected" />
      <Stack.Screen name="log" />
      <Stack.Screen name="walkin" />
      <Stack.Screen name="checkout" />
      <Stack.Screen name="handover" />
      <Stack.Screen name="lookup" />
      <Stack.Screen name="blacklist" />
      <Stack.Screen name="suspicious" />
      <Stack.Screen name="incident" />
      <Stack.Screen name="vehicles" />
      <Stack.Screen name="analytics" />
      <Stack.Screen name="overstay" />
    </Stack>
  );
}
