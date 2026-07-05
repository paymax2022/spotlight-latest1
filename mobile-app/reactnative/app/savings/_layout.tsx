import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function SavingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />

      {/* Goal Vaults */}
      <Stack.Screen name="vault/create" />
      <Stack.Screen name="vault/[id]" />
      <Stack.Screen name="vault/auto-save" />
      <Stack.Screen name="vault/early-withdraw" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Ajo / Esusu */}
      <Stack.Screen name="ajo/discover" />
      <Stack.Screen name="ajo/create" />
      <Stack.Screen name="ajo/[id]" />
      <Stack.Screen name="ajo/contribute" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="ajo/payout" />

      {/* Group Target */}
      <Stack.Screen name="target/create" />
      <Stack.Screen name="target/[id]" />
    </Stack>
  );
}
