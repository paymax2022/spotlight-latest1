// ── Paymax · Admin Console — Providers ───────────────────────────────────────
// Integration health (custody / liquidity / payments / market-data) grouped by
// status (up / degraded / down) with a health-summary KPI row. Read-only.

import React, { useMemo } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import StateView from '@/components/StateView';
import SectionHeader from '@/components/SectionHeader';
import { AdminHeader, ListCard, KpiCard, ProviderRow } from '@/features/admin/components';
import { useAdminRole } from '@/features/admin/context/AdminRole';
import { useProviders } from '@/features/admin/hooks/useAdmin';
import { can } from '@/features/admin/constants/admin.constants';
import type { ProviderHealth, ProviderStatus } from '@/features/admin/types/admin.types';

const GROUPS: { status: ProviderStatus; title: string }[] = [
  { status: 'healthy', title: 'Up' },
  { status: 'degraded', title: 'Degraded' },
  { status: 'down', title: 'Down' },
];

export default function AdminProvidersScreen() {
  const { role } = useAdminRole();
  const allowed = can(role, 'provider.view');

  const providers = useProviders();
  const list: ProviderHealth[] = providers.data ?? [];

  const counts = useMemo(
    () => ({
      healthy: list.filter((p) => p.status === 'healthy').length,
      degraded: list.filter((p) => p.status === 'degraded').length,
      down: list.filter((p) => p.status === 'down').length,
    }),
    [list],
  );

  const grouped = useMemo(
    () => GROUPS.map((g) => ({ ...g, items: list.filter((p) => p.status === g.status) })).filter((g) => g.items.length > 0),
    [list],
  );

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <AdminHeader title="Providers" subtitle="Integration health" />
        <StateView
          kind="empty"
          icon="Lock"
          title="No access"
          message="Your role can't view provider health."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="Providers" subtitle="Integration health" />

      {providers.isLoading ? (
        <StateView kind="loading" message="Loading providers…" />
      ) : providers.isError ? (
        <StateView
          kind="error"
          title="Couldn't load providers"
          message={(providers.error as Error)?.message ?? 'Please check your connection and try again.'}
          actionLabel="Retry"
          onAction={() => providers.refetch()}
        />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="Plug" title="No providers" message="No integrations are configured yet." />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={providers.isRefetching} onRefresh={() => providers.refetch()} tintColor={Colors.primary} />
          }
        >
          <View style={styles.grid}>
            <View style={styles.gridCell}>
              <KpiCard label="Up" value={String(counts.healthy)} icon="CircleCheck" iconColor={Colors.teal} iconBg={Colors.iconBgTeal} />
            </View>
            <View style={styles.gridCell}>
              <KpiCard label="Degraded" value={String(counts.degraded)} icon="TriangleAlert" iconColor={Colors.onWarning} iconBg={Colors.iconBgGold} />
            </View>
            <View style={styles.gridCell}>
              <KpiCard label="Down" value={String(counts.down)} icon="CircleX" iconColor={Colors.error} iconBg={Colors.iconBgRed} />
            </View>
          </View>

          {grouped.map((g) => (
            <View key={g.status} style={styles.groupWrap}>
              <SectionHeader title={g.title} />
              <ListCard flush>
                {g.items.map((p, i, arr) => (
                  <ProviderRow key={p.name} provider={p} last={i === arr.length - 1} />
                ))}
              </ListCard>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.containerMargin,
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  gridCell: { flexGrow: 1, flexBasis: '30%', minWidth: '30%' },
  groupWrap: { marginTop: Spacing.md },
});
