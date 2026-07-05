import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

/**
 * Shared Health platform stack (Phase 0). The pharmacy/lab/vet verticals mount
 * their own sub-stacks under app/health/<vertical>/* (owned by those teams).
 */
export default function HealthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Hub */}
      <Stack.Screen name="index" />

      {/* Records vault */}
      <Stack.Screen name="records/index" />
      <Stack.Screen name="records/[id]" />
      <Stack.Screen name="records/share" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Consent */}
      <Stack.Screen name="consent/index" />
      <Stack.Screen name="consent/grant" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Intake (schema-driven renderer) */}
      <Stack.Screen name="intake/[schemaId]" />

      {/* My health profile (M17 — longitudinal record from intakes) */}
      <Stack.Screen name="profile/index" />

      {/* Tele-consult */}
      <Stack.Screen name="consult/lobby" />
      <Stack.Screen name="consult/room" options={{ gestureEnabled: false }} />

      {/* Provider profile */}
      <Stack.Screen name="provider/[id]" />
    </Stack>
  );
}
