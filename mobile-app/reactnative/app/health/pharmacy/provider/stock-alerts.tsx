import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { BellRing, Boxes, ShieldAlert, Ban } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useStockAlerts } from '@/features/health/pharmacy/hooks';
import type { StockAlert } from '@/features/health/pharmacy/types';

/** Why the line cannot be bought, and what fixes it. The schema has no reorder
 *  threshold, so nothing here claims a product is "running low" — only the states
 *  the server actually reports for the owner's shelf. */
const REASON_META: Record<StockAlert['reason'], { title: string; message: string; icon: typeof Boxes; bg: string; fg: string }> = {
  sold_out: {
    title: 'Sold out',
    message: 'Tracked stock reached zero — restock to make it buyable again.',
    icon: BellRing,
    bg: Colors.iconBgRed,
    fg: Colors.error,
  },
  deactivated: {
    title: 'Off shelf',
    message: 'You took this line off sale. Reactivate it when it is back in stock.',
    icon: Ban,
    bg: Colors.surfaceContainerHigh,
    fg: Colors.onSurfaceVariant,
  },
  nafdac_pending: {
    title: 'NAFDAC pending',
    message: 'Patients cannot buy this until its registration shows as REGISTERED (HL-5).',
    icon: ShieldAlert,
    bg: Colors.iconBgGold,
    fg: Colors.onWarning,
  },
};

export default function StockAlertsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useStockAlerts();

  const alerts = data ?? [];
  const soldOut = alerts.filter((a) => a.reason === 'sold_out').length;
  const offShelf = alerts.filter((a) => a.reason === 'deactivated').length;
  const pending = alerts.filter((a) => a.reason === 'nafdac_pending').length;

  const renderRow = ({ item }: { item: StockAlert }) => {
    const meta = REASON_META[item.reason];
    const Icon = meta.icon;
    return (
      <View style={[styles.card, shadow1]}>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: meta.bg }]}>
            <Icon size={18} color={meta.fg} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>{meta.message}</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: meta.bg }]}>
            <Text style={[styles.pillText, { color: meta.fg }]}>{meta.title}</Text>
          </View>
        </View>
        <Pressable
          style={styles.fixBtn}
          accessibilityRole="button"
          accessibilityLabel={`Fix ${item.name}`}
          onPress={() => router.push({ pathname: '/health/pharmacy/provider/add-product', params: { id: item.productId } })}
        >
          <Text style={styles.fixText}>{item.reason === 'sold_out' ? 'Restock' : 'Edit listing'}</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Needs attention" subtitle="Lines patients cannot buy" />

      {isLoading ? (
        <StateView kind="loading" message="Loading alerts…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load alerts" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(a) => a.productId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListHeaderComponent={
            alerts.length > 0 ? (
              <View style={[styles.summary, shadow1]}>
                <View style={[styles.iconBox, { backgroundColor: Colors.iconBgBlue }]}>
                  <Boxes size={18} color={Colors.secondary} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryTitle}>{alerts.length} line(s) patients cannot buy</Text>
                  <Text style={styles.summaryMeta}>
                    {soldOut} sold out · {offShelf} off shelf · {pending} awaiting NAFDAC
                  </Text>
                </View>
              </View>
            ) : null
          }
          renderItem={renderRow}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="PackageCheck"
              title="Everything is buyable"
              message="Every product on your shelf is active, registered and in stock."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40, flexGrow: 1 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  summaryTitle: { ...Typography.labelLg, color: Colors.onSurface },
  summaryMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBox: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 1 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: Spacing.sm + 2, paddingVertical: 5, borderRadius: Radius.full },
  pillText: { ...Typography.labelSm, fontWeight: '700' as const },
  fixBtn: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
  },
  fixText: { ...Typography.labelMd, color: Colors.onPrimary },
});
