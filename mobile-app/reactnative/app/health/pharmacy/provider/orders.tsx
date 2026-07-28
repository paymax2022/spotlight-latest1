import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ScrollText, ChevronRight, ClipboardList } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import PharmacyStatusPill from '@/features/health/components/PharmacyStatusPill';
import { useProviderOrders } from '@/features/health/pharmacy/hooks';
import { formatNaira, formatDate } from '@/features/health/constants/health.constants';
import type { PharmacyOrder, OrderStatus } from '@/features/health/pharmacy/types';

type Group = 'all' | 'new' | 'active' | 'done';

const GROUP_OPTIONS: { value: Group; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'active', label: 'In progress' },
  { value: 'done', label: 'Completed' },
];

const NEW_STATUSES: OrderStatus[] = ['created', 'rx_pending', 'confirmed'];
const ACTIVE_STATUSES: OrderStatus[] = ['dispensed', 'in_delivery', 'ready_for_pickup'];
const DONE_STATUSES: OrderStatus[] = ['delivered', 'collected', 'closed'];

function groupOf(status: OrderStatus): Group {
  if (NEW_STATUSES.includes(status)) return 'new';
  if (ACTIVE_STATUSES.includes(status)) return 'active';
  if (DONE_STATUSES.includes(status)) return 'done';
  return 'all';
}

function destFor(order: PharmacyOrder) {
  if (order.status === 'rx_pending') {
    return { pathname: '/health/pharmacy/provider/rx-verify', params: { id: order.rxId ?? '' } } as const;
  }
  return { pathname: '/health/pharmacy/provider/dispense', params: { id: order.id } } as const;
}

export default function ProviderOrdersScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useProviderOrders();
  const [group, setGroup] = useState<Group>('new');

  const filtered = useMemo(() => {
    const all = data ?? [];
    if (group === 'all') return all;
    return all.filter((o) => groupOf(o.status) === group);
  }, [data, group]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Order queue" subtitle="Dispense & fulfil" />

      <View style={styles.filter}>
        <SegmentedControl options={GROUP_OPTIONS} value={group} onChange={setGroup} />
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading orders…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load orders" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderItem={({ item }) => {
            const g = groupOf(item.status);
            const tappable = g === 'new' || g === 'active';
            const Wrap: any = tappable ? Pressable : View;
            return (
              <Wrap
                style={[styles.card, shadow1]}
                {...(tappable ? { onPress: () => router.push(destFor(item)) } : {})}
              >
                <View style={styles.head}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ref}>{item.reference}</Text>
                    <Text style={styles.sub}>{formatDate(item.createdAt)}</Text>
                  </View>
                  <PharmacyStatusPill order={item.status} />
                </View>

                <Text style={styles.items} numberOfLines={2}>
                  {item.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}
                </Text>

                <View style={styles.footerRow}>
                  <View style={styles.leftFoot}>
                    <Text style={styles.total}>{formatNaira(item.totalKobo)}</Text>
                    {item.requiresRx ? (
                      <View style={styles.rxTag}>
                        <ScrollText size={12} color={Colors.secondary} strokeWidth={2.2} />
                        <Text style={styles.rxTagText}>Rx</Text>
                      </View>
                    ) : null}
                  </View>
                  {tappable ? <ChevronRight size={18} color={Colors.outline} strokeWidth={2} /> : null}
                </View>
              </Wrap>
            );
          }}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="ClipboardList"
              title="No orders here"
              message={group === 'new' ? 'New orders will appear here as they come in.' : 'Nothing in this view yet.'}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filter: { paddingBottom: Spacing.sm },
  list: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 100, flexGrow: 1 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ref: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  items: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  leftFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  total: { ...Typography.titleMd, fontSize: 16, color: Colors.primary },
  rxTag: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.iconBgBlue, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  rxTagText: { ...Typography.labelSm, fontWeight: '700' as const, color: Colors.secondary },
});
