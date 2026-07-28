import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Truck, Package, ChevronRight, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PharmacyStatusPill from '@/features/health/components/PharmacyStatusPill';
import { useOrders } from '@/features/health/pharmacy/hooks';
import { formatNaira, formatDate } from '@/features/health/constants/health.constants';
import type { PharmacyOrder } from '@/features/health/pharmacy/types';

function destFor(order: PharmacyOrder) {
  const active = !['delivered', 'collected', 'closed', 'cancelled', 'refunded'].includes(order.status);
  if (active && order.fulfilment === 'pickup') return { pathname: '/health/pharmacy/pickup-code', params: { id: order.id } } as const;
  if (active) return { pathname: '/health/pharmacy/delivery-tracking', params: { id: order.id } } as const;
  return { pathname: '/health/pharmacy/reorder', params: { id: order.id } } as const;
}

export default function OrdersScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useOrders();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My orders" subtitle="Track & reorder" />

      {isLoading ? (
        <StateView kind="loading" message="Loading orders…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load orders" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderItem={({ item }) => {
            const completed = ['delivered', 'collected', 'closed'].includes(item.status);
            return (
              <Pressable style={[styles.card, shadow1]} onPress={() => router.push(destFor(item))}>
                <View style={styles.head}>
                  <View style={[styles.icon, { backgroundColor: item.fulfilment === 'delivery' ? Colors.iconBgBlue : Colors.iconBgTeal }]}>
                    {item.fulfilment === 'delivery' ? (
                      <Truck size={18} color={Colors.secondary} strokeWidth={2} />
                    ) : (
                      <Package size={18} color={Colors.teal} strokeWidth={2} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.ref}>{item.reference}</Text>
                    <Text style={styles.sub}>
                      {item.pharmacyName} · {formatDate(item.createdAt)}
                    </Text>
                  </View>
                  <PharmacyStatusPill order={item.status} />
                </View>

                <Text style={styles.items} numberOfLines={1}>
                  {item.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}
                </Text>

                <View style={styles.footer}>
                  <Text style={styles.total}>{formatNaira(item.totalKobo)}</Text>
                  {completed ? (
                    <View style={styles.actions}>
                      <Pressable
                        style={styles.smallBtn}
                        onPress={() => router.push({ pathname: '/health/pharmacy/ratings', params: { pharmacyId: item.pharmacyId, orderId: item.id } })}
                      >
                        <Star size={13} color={Colors.gold} strokeWidth={2} />
                        <Text style={styles.smallBtnText}>Rate</Text>
                      </Pressable>
                      <Pressable
                        style={styles.smallBtnPrimary}
                        onPress={() => router.push({ pathname: '/health/pharmacy/reorder', params: { id: item.id } })}
                      >
                        <Text style={styles.smallBtnPrimaryText}>Reorder</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                  )}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="Package"
              title="No orders yet"
              message="Your pharmacy orders will appear here."
              actionLabel="Browse medicines"
              onAction={() => router.push('/health/pharmacy/search')}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
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
  icon: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  ref: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  items: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { ...Typography.titleMd, fontSize: 16, color: Colors.primary },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  smallBtnText: { ...Typography.labelMd, color: Colors.onSurface },
  smallBtnPrimary: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  smallBtnPrimaryText: { ...Typography.labelMd, color: Colors.onPrimary },
});
