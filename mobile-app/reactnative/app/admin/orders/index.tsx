// ── Paymax · Admin Console — Orders ──────────────────────────────────────────
// Trade activity across crypto & stock, filterable (all/crypto/stock/failed/
// pending) and searchable by ref / symbol / user. KPI tiles give quick counts.

import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import StateView from '@/components/StateView';
import SearchBar from '@/components/SearchBar';
import SegmentedControl from '@/components/SegmentedControl';
import { AdminHeader, ListCard, KpiCard, OrderRow } from '@/features/admin/components';
import { useAdminRole } from '@/features/admin/context/AdminRole';
import { useAdminOrders } from '@/features/admin/hooks/useAdmin';
import { can } from '@/features/admin/constants/admin.constants';
import type { OrderFilter } from '@/features/admin/types/admin.types';
import { HomeMenuButton } from '@/components/HomeMenu';

const FILTERS: { value: OrderFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'stock', label: 'Stock' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
];

export default function AdminOrdersScreen() {
  const { role } = useAdminRole();
  const allowed = can(role, 'order.view');

  const [filter, setFilter] = useState<OrderFilter>('all');
  const [query, setQuery] = useState('');
  const orders = useAdminOrders(filter);

  const list = orders.data ?? [];

  const counts = useMemo(
    () => ({
      total: list.length,
      failed: list.filter((o) => o.status === 'Failed' || o.status === 'Reversed').length,
      pending: list.filter((o) => o.status === 'Pending' || o.status === 'Processing').length,
    }),
    [list],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (o) =>
        o.ref.toLowerCase().includes(q) ||
        o.symbol.toLowerCase().includes(q) ||
        o.user.toLowerCase().includes(q) ||
        o.providerRef.toLowerCase().includes(q),
    );
  }, [list, query]);

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <AdminHeader title="Orders" subtitle="Trade activity" />
        <StateView
          kind="empty"
          icon="Lock"
          title="No access"
          message="Your role can't view order activity."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="Orders" subtitle="Trade activity" />

      <SearchBar placeholder="Search ref, symbol or user" value={query} onChangeText={setQuery} />

      <View style={styles.filterWrap}>
        <SegmentedControl<OrderFilter> options={FILTERS} value={filter} onChange={setFilter} scrollable />
      </View>

      {orders.isLoading ? (
        <StateView kind="loading" message="Loading orders…" />
      ) : orders.isError ? (
        <StateView
          kind="error"
          title="Couldn't load orders"
          message={(orders.error as Error)?.message ?? 'Please check your connection and try again.'}
          actionLabel="Retry"
          onAction={() => orders.refetch()}
        />
      ) : list.length === 0 ? (
        <StateView kind="empty" icon="ArrowLeftRight" title="No orders" message="No orders match this filter yet." />
      ) : filtered.length === 0 ? (
        <StateView kind="empty" icon="SearchX" title="No matches" message={`No orders match "${query}".`} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={orders.isRefetching} onRefresh={() => orders.refetch()} tintColor={Colors.primary} />
          }
        >
          <View style={styles.grid}>
            <View style={styles.gridCell}>
              <KpiCard label="Total" value={String(counts.total)} icon="ArrowLeftRight" iconColor={Colors.secondary} iconBg={Colors.iconBgBlue} />
              <View style={{ flex: 1 }} />
              <HomeMenuButton />
            </View>
            <View style={styles.gridCell}>
              <KpiCard label="Failed" value={String(counts.failed)} icon="TriangleAlert" iconColor={Colors.error} iconBg={Colors.iconBgRed} />
            </View>
            <View style={styles.gridCell}>
              <KpiCard label="Pending" value={String(counts.pending)} icon="Clock" iconColor={Colors.onWarning} iconBg={Colors.iconBgGold} />
            </View>
          </View>

          <ListCard flush>
            {filtered.map((o, i, arr) => (
              <OrderRow key={`${o.ref}-${o.providerRef}`} order={o} last={i === arr.length - 1} />
            ))}
          </ListCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filterWrap: { marginBottom: Spacing.md },
  scroll: { paddingBottom: Spacing.xxl },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.containerMargin,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  gridCell: { flexGrow: 1, flexBasis: '30%', minWidth: '30%' },
});
