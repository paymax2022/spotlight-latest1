import { Stack } from 'expo-router';
import ProviderRouteGuard from '@/features/providerPortal/ProviderRouteGuard';

// Estate managers are the `estates.admin_id` owners; delegated staff use their
// own operational screens, not this console.
const PROVIDER_RULES = [{ type: 'estate_manager', prefix: '' }] as const;

export default function EstateAdminLayout() {
  return (
    <ProviderRouteGuard rules={PROVIDER_RULES}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
      </Stack>
    </ProviderRouteGuard>
  );
}
