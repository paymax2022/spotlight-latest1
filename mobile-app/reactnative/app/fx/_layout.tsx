import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function FxLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Home & Balances (B) */}
      <Stack.Screen name="index" />
      <Stack.Screen name="add-wallet" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />

      {/* Convert / Exchange (C) */}
      <Stack.Screen name="convert/index" />
      <Stack.Screen name="convert/confirm" />
      <Stack.Screen name="convert/processing" options={{ gestureEnabled: false }} />
      <Stack.Screen name="convert/success" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="convert/failed" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Send / Payout (D) — select beneficiary → amount → review → result */}
      <Stack.Screen name="send/index" />
      <Stack.Screen name="send/new-beneficiary" />
      <Stack.Screen name="send/amount" />
      <Stack.Screen name="send/recurring" />
      <Stack.Screen name="send/bulk" />
      <Stack.Screen name="send/review" />
      <Stack.Screen name="send/processing" options={{ gestureEnabled: false }} />
      <Stack.Screen name="send/success" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="send/failed" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Beneficiaries (G) */}
      <Stack.Screen name="beneficiaries/index" />
      <Stack.Screen name="beneficiaries/[id]" />

      {/* Receive / Collections (E) */}
      <Stack.Screen name="receive/index" />
      <Stack.Screen name="receive/[id]" />

      {/* Cards (F) */}
      <Stack.Screen name="cards/index" />
      <Stack.Screen name="cards/new" />
      <Stack.Screen name="cards/[id]/index" />
      <Stack.Screen name="cards/[id]/fund" />
      <Stack.Screen name="cards/[id]/controls" />
      <Stack.Screen name="cards/[id]/transactions" />

      {/* Transactions (H) */}
      <Stack.Screen name="transactions/index" />
      <Stack.Screen name="transactions/[id]" />
      <Stack.Screen name="transactions/dispute/[id]" />

      {/* KYC / KYB verification (A) */}
      <Stack.Screen name="kyc/index" />
      <Stack.Screen name="kyc/consents" />
      <Stack.Screen name="kyc/permissions" />
      <Stack.Screen name="kyc/identity" />
      <Stack.Screen name="kyc/selfie" />
      <Stack.Screen name="kyc/business" />
      <Stack.Screen name="kyc/directors" />
      <Stack.Screen name="kyc/documents" />
      <Stack.Screen name="kyc/submitted" options={{ gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="kyc/status" />

      {/* Business / multi-user (I) */}
      <Stack.Screen name="business/index" />
      <Stack.Screen name="business/team" />
      <Stack.Screen name="business/approvals" />
      <Stack.Screen name="business/thresholds" />
      <Stack.Screen name="business/activity" />
      <Stack.Screen name="business/developer" />

      {/* Notifications (J) */}
      <Stack.Screen name="notifications" />

      {/* Settings (K) */}
      <Stack.Screen name="settings/index" />
      <Stack.Screen name="settings/limits" />
      <Stack.Screen name="settings/stablecoin" />
      <Stack.Screen name="settings/notifications" />

      {/* Global edge / error states (L) */}
      <Stack.Screen name="states/[kind]" options={{ animation: 'fade' }} />

      {/* Rate alerts (C) */}
      <Stack.Screen name="rate-alerts/index" />
      <Stack.Screen name="rate-alerts/new" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
    </Stack>
  );
}
