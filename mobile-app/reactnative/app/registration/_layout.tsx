import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function RegistrationLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="applications" />
      <Stack.Screen name="[id]/wizard" />
      <Stack.Screen name="[id]/submit" />
      <Stack.Screen name="[id]/success" />
      <Stack.Screen name="[id]/status" />
    </Stack>
  );
}
