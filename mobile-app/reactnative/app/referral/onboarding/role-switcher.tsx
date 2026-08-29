import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import StateView from '@/components/StateView';
import { ReferralHeader, RoleSwitcherSheet } from '@/features/referral/components';
import { useRoleContext, useSetActiveRole } from '@/features/referral/foundation/hooks';
import type { ReferralRole } from '@/features/referral/constants/referral.constants';

// M-ONB-09 — Role/context switcher. Presented as a bottom sheet over a dim
// backdrop; closing it returns to the previous screen.
const VERIFY_ROUTE: Record<ReferralRole, string | null> = {
  referrer: null,
  ambassador: '/referral/onboarding/become-ambassador',
  agent: '/referral/onboarding/become-agent',
  merchant: '/referral/onboarding/become-merchant',
};

export default function RoleSwitcher() {
  const { data, isLoading, isError, refetch } = useRoleContext();
  const setRole = useSetActiveRole();

  const close = () => { if (router.canGoBack()) goBack('/referral'); else router.replace('/referral/(tabs)/home'); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ReferralHeader title="Roles" onBack={close} />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load roles" actionLabel="Retry" onAction={refetch} />
      ) : (
        <View style={styles.body}>
          <Text style={styles.hint}>One account, many roles. Switch how you show up in the Earn hub.</Text>
          <RoleSwitcherSheet
            visible
            active={data.active}
            available={data.available}
            lockedUntilVerified={data.lockedUntilVerified}
            onClose={close}
            onSelect={(role) => setRole.mutate(role, { onSuccess: close })}
            onLockedPress={(role) => { const r = VERIFY_ROUTE[role]; if (r) router.push(r as never); }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1 },
  hint: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, paddingHorizontal: Spacing.containerMargin },
});
