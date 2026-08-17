import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, Pill } from 'lucide-react-native';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { usePharmacyOrders } from '@/features/pharmacymerchant/hooks';
import { stateLabel, inboxRank, needsPharmacistAttention } from '@/features/pharmacymerchant/actions';

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

type Filter = 'todo' | 'all';

/**
 * The pharmacist's order inbox.
 *
 * Until this screen the pharmacy could take a payment and had every fulfilment
 * action server-side, but no way to find out WHICH orders were waiting — the
 * only reads were by id, or an admin list. Money sat in escrow with no queue to
 * work.
 *
 * Defaults to "needs you" rather than everything: an inbox sorted purely by date
 * buries the order someone is standing at the counter for.
 */
export default function PharmacyOrdersScreen() {
  const [filter, setFilter] = useState<Filter>('todo');
  const q = usePharmacyOrders();

  const orders = useMemo(() => {
    const all = q.data ?? [];
    const visible = filter === 'todo' ? all.filter((o) => needsPharmacistAttention(o.state)) : all;
    // Actionable first, then newest — see inboxRank.
    return [...visible].sort((a, b) => {
      const r = inboxRank(a.state) - inboxRank(b.state);
      if (r !== 0) return r;
      return (b.created_at ?? '').localeCompare(a.created_at ?? '');
    });
  }, [q.data, filter]);

  const todoCount = (q.data ?? []).filter((o) => needsPharmacistAttention(o.state)).length;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Pharmacy orders" />

      <View style={s.tabs}>
        {(['todo', 'all'] as Filter[]).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[s.tab, filter === f && s.tabActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f }}
          >
            <Text style={[s.tabText, filter === f && s.tabTextActive]}>
              {f === 'todo' ? `Needs you${todoCount ? ` (${todoCount})` : ''}` : 'All orders'}
            </Text>
          </Pressable>
        ))}
      </View>

      {q.isLoading ? (
        <StateView kind="loading" title="Loading orders" />
      ) : q.isError ? (
        <StateView
          kind="error"
          title="Couldn’t load your orders"
          message="Check your connection and try again."
          actionLabel="Retry"
          onAction={() => q.refetch()}
        />
      ) : orders.length === 0 ? (
        <StateView
          kind="empty"
          icon="Package"
          title={filter === 'todo' ? 'Nothing waiting on you' : 'No orders yet'}
          message={
            filter === 'todo'
              ? 'New orders appear here the moment a customer pays.'
              : 'Orders customers place with your pharmacy will appear here.'
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={s.body}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
        >
          {orders.map((o) => (
            <Pressable
              key={o.id}
              style={({ pressed }) => [s.card, shadow1, pressed && { opacity: 0.9 }]}
              onPress={() => router.push(`/pharmacy/order/${o.id}` as never)}
              accessibilityRole="button"
              accessibilityLabel={`Order ${o.id.slice(0, 8)}, ${stateLabel(o.state)}, ${naira(o.total_kobo)}`}
            >
              <View style={s.iconWrap}>
                <Pill size={18} color={Colors.primary} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.rowBetween}>
                  {/* The id is the pharmacist's handle on the order at the counter. */}
                  <Text style={s.orderId}>#{o.id.slice(0, 8)}</Text>
                  <Text style={s.total}>{naira(o.total_kobo)}</Text>
                </View>
                <View style={s.metaRow}>
                  <View style={[s.pill, needsPharmacistAttention(o.state) && s.pillActive]}>
                    <Text style={[s.pillText, needsPharmacistAttention(o.state) && s.pillTextActive]}>
                      {stateLabel(o.state)}
                    </Text>
                  </View>
                  {o.prescription_id ? <Text style={s.rx}>Rx</Text> : null}
                </View>
              </View>
              <ChevronRight size={16} color={Colors.outline} strokeWidth={2} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.md, gap: Spacing.sm },
  tabs: { flexDirection: 'row', gap: Spacing.xs, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  tab: {
    paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  tabTextActive: { color: Colors.onPrimary },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  iconWrap: {
    width: 38, height: 38, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLow,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orderId: { ...Typography.labelLg, color: Colors.onSurface },
  total: { ...Typography.labelLg, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 4 },
  pill: {
    paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow,
  },
  pillActive: { backgroundColor: Colors.primary },
  pillText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  pillTextActive: { color: Colors.onPrimary },
  rx: { ...Typography.caption, color: Colors.secondary },
});
