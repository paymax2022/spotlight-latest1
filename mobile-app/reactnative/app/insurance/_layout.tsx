import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function InsuranceLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Hub + browse */}
      <Stack.Screen name="index" />
      <Stack.Screen name="browse" />
      <Stack.Screen name="product/[code]" />
      <Stack.Screen name="disclosure" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Quote → bind */}
      <Stack.Screen name="quote/form" />
      <Stack.Screen name="quote/review" />
      <Stack.Screen name="quote/terms" />
      <Stack.Screen name="kyc-gap" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="consent" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Pay */}
      <Stack.Screen name="pay/summary" />
      <Stack.Screen name="pay/success" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="pay/failure" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Policy wallet */}
      <Stack.Screen name="policies/index" />
      <Stack.Screen name="policies/[id]/index" />
      <Stack.Screen name="policies/[id]/certificate" />
      <Stack.Screen name="policies/[id]/beneficiaries" />

      {/* Lifecycle */}
      <Stack.Screen name="policies/[id]/renew" />
      <Stack.Screen name="policies/[id]/cancel" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="policies/[id]/refund-status" />
    </Stack>
  );
}
