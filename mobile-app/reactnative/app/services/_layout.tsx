import { Stack } from 'expo-router';

export default function ServicesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="airtime" />
      <Stack.Screen name="data" />
      <Stack.Screen name="electricity" />
      <Stack.Screen name="cable-tv" />
      <Stack.Screen name="bills" />
      <Stack.Screen name="beneficiaries" />
      <Stack.Screen name="education" />
      <Stack.Screen name="transfer" />
      <Stack.Screen name="cards" />
      <Stack.Screen name="fx" />
      <Stack.Screen name="food" />
      <Stack.Screen name="telemedicine" />
      <Stack.Screen name="receipt/[id]" />
      <Stack.Screen name="transactions/index" />
      <Stack.Screen name="transactions/[id]" />
      <Stack.Screen name="paystack/[reference]" />
    </Stack>
  );
}
