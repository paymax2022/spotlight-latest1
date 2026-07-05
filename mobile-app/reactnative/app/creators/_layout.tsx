import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function CreatorsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="storefront/[id]" />
      <Stack.Screen name="gated/[id]" />
      <Stack.Screen name="content/manage" />
      <Stack.Screen name="earnings" />
      <Stack.Screen name="my-subscriptions" />
      <Stack.Screen name="become-creator" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="tip" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="subscribe" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      <Stack.Screen name="payout" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
    </Stack>
  );
}
