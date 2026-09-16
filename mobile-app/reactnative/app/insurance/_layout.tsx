import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Protection stack.
 *
 * The live member journey is: hub → browse → product (with its plan picker) →
 * application (the product's own schema, rendered dynamically) → review (the
 * insurer's real premium) → success or failure → policy wallet → claims.
 *
 * Claims are read here and FILED on the insurer's hosted flow — MyCover has no
 * claim-filing endpoint — so there is no claim form route.
 */
export default function InsuranceLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Discover */}
      <Stack.Screen name="index" />
      <Stack.Screen name="browse" />
      <Stack.Screen name="product/[code]" />
      <Stack.Screen
        name="disclosure"
        options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
      />

      {/* Buy */}
      <Stack.Screen name="quote/form" />
      <Stack.Screen name="quote/review" />
      <Stack.Screen name="kyc-gap" options={{ animation: 'slide_from_bottom' }} />

      {/* Result. Both are terminal: the back gesture must not return a person
          into a half-finished purchase they have already been told the outcome of. */}
      <Stack.Screen name="pay/success" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="pay/failure" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Policy wallet */}
      <Stack.Screen name="policies/index" />
      <Stack.Screen name="policies/[id]/index" />
      <Stack.Screen name="policies/[id]/certificate" />
      <Stack.Screen name="policies/[id]/beneficiaries" />
      <Stack.Screen name="policies/[id]/renew" />
      <Stack.Screen name="policies/[id]/cancel" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="policies/[id]/refund-status" />

      {/* Claims */}
      <Stack.Screen name="claims/index" />
      <Stack.Screen name="claims/start" />
      <Stack.Screen name="claims/status" />
    </Stack>
  );
}
