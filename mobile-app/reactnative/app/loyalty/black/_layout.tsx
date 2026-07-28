import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function BlackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="partners" />
      <Stack.Screen name="redeem" />
      <Stack.Screen name="upgrade" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
    </Stack>
  );
}
