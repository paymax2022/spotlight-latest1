// ── Paymax · Admin Console — Feature flags ───────────────────────────────────
// One ToggleRow per flag (label + which modules it controls). Toggling calls
// useSetFeatureFlag().mutate({ key, enabled }) — gated by `flag.toggle`; the row
// is disabled (read-only) for roles without the permission. Errors surface in a
// banner.

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { AdminHeader, ListCard, ToggleRow } from '@/features/admin/components';
import { useAdminRole } from '@/features/admin/context/AdminRole';
import { useFeatureFlags, useSetFeatureFlag } from '@/features/admin/hooks/useAdmin';
import { can } from '@/features/admin/constants/admin.constants';

/** Which app modules each flag gates (shown as the row sublabel). */
const FLAG_MODULES: Record<string, string> = {
  invest_crypto: 'Controls: Crypto tab, buy/sell, portfolio',
  invest_stocks: 'Controls: Stocks tab, orders, watchlist',
  crypto_withdrawals: 'Controls: Crypto withdraw flow & queue',
  crypto_swap: 'Controls: In-asset swap module',
  referrals: 'Controls: Referral programme & rewards',
};

function modulesFor(key: string): string {
  return FLAG_MODULES[key] ?? 'Controls one or more app modules';
}

export default function AdminFlagsScreen() {
  const { role } = useAdminRole();
  const allowed = can(role, 'flag.toggle');

  const flags = useFeatureFlags();
  const setFlag = useSetFeatureFlag();

  const [error, setError] = useState<string | undefined>();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const list = flags.data ?? [];

  const onToggle = (key: string, enabled: boolean) => {
    if (!allowed) return;
    setError(undefined);
    setPendingKey(key);
    setFlag.mutate(
      { key, enabled },
      {
        onSettled: () => setPendingKey(null),
        onError: (e) => setError((e as Error)?.message ?? 'Could not update the flag. Please try again.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="Feature Flags" subtitle="Toggle features" />

      {flags.isLoading ? (
        <StateView kind="loading" message="Loading flags…" />
      ) : flags.isError ? (
        <StateView
          kind="error"
          title="Couldn't load feature flags"
          message={(flags.error as Error)?.message ?? 'Please check your connection and try again.'}
          actionLabel="Retry"
          onAction={() => flags.refetch()}
        />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="ToggleRight" title="No flags" message="Feature flags will appear here." />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={flags.isRefetching} onRefresh={() => flags.refetch()} tintColor={Colors.primary} />
          }
        >
          {!allowed ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>Read-only — your role can view flags but can't toggle them.</Text>
            </View>
          ) : null}
          {error ? (
            <View style={[styles.banner, styles.errorBanner]}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <ListCard flush>
            {list.map((flag, i, arr) => (
              <ToggleRow
                key={flag.key}
                label={flag.label}
                sublabel={modulesFor(flag.key)}
                value={flag.enabled}
                onChange={(next) => onToggle(flag.key, next)}
                disabled={!allowed || (setFlag.isPending && pendingKey === flag.key)}
                last={i === arr.length - 1}
              />
            ))}
          </ListCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl, paddingTop: Spacing.sm, gap: Spacing.md },
  banner: {
    marginHorizontal: Spacing.containerMargin,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.md,
  },
  bannerText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  errorBanner: { backgroundColor: Colors.errorContainer },
  errorText: { ...Typography.labelSm, color: Colors.error },
});
