import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';
import { AdminRoleProvider } from '@/features/admin/context/AdminRole';

/**
 * Paymax · Admin Console stack. Mirrors the crypto module's navigation
 * conventions (slide-from-right default, headers hidden — each screen renders
 * its own AdminHeader). The whole surface is wrapped in the AdminRoleProvider so
 * every screen can read/select the current admin role (sent as X-Admin-Role on
 * live requests). The console sits behind the `admin_console` feature flag.
 */
export default function AdminLayout() {
  return (
    <AdminRoleProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: 'slide_from_right',
        }}
      >
        {/* Dashboard / console home */}
        <Stack.Screen name="index" />

        {/* Users */}
        <Stack.Screen name="users/index" />
        <Stack.Screen name="users/[id]" />

        {/* KYC review queue */}
        <Stack.Screen name="kyc/index" />
        <Stack.Screen name="kyc/[id]" />

        {/* Trading controls & activity */}
        <Stack.Screen name="assets/index" />
        <Stack.Screen name="orders/index" />

        {/* Risk, providers, withdrawals, reconciliation */}
        <Stack.Screen name="risk/index" />
        <Stack.Screen name="providers/index" />
        <Stack.Screen name="withdrawals/index" />
        <Stack.Screen name="reconciliation" />

        {/* Maker-checker approvals */}
        <Stack.Screen name="approvals/index" />

        {/* Pricing & feature config */}
        <Stack.Screen name="fees/index" />
        <Stack.Screen name="flags/index" />

        {/* Audit trail & settings */}
        <Stack.Screen name="audit/index" />
        <Stack.Screen name="settings" />
      </Stack>
    </AdminRoleProvider>
  );
}
