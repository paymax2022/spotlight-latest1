import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/** Multi-provider KYC step-up wizard (K1–K15). */
export default function KycVerifyLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="requirements" />
      <Stack.Screen name="consent" />
      <Stack.Screen name="id-type" />
      <Stack.Screen name="id-number" />
      <Stack.Screen name="id-verifying" options={{ gestureEnabled: false }} />
      <Stack.Screen name="selfie" />
      <Stack.Screen name="document" />
      <Stack.Screen name="document-processing" options={{ gestureEnabled: false }} />
      <Stack.Screen name="address" />
      <Stack.Screen name="pending" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="success" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="failed" options={{ gestureEnabled: false, animation: 'fade' }} />
    </Stack>
  );
}
