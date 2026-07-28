import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function FeaturedLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="new" />
      <Stack.Screen name="promotions/index" />
      <Stack.Screen name="promotions/[id]" />
    </Stack>
  );
}
