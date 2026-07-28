import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Bell, BellRing, Boxes } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useStockAlerts } from '@/features/health/pharmacy/hooks';
import type { StockAlert } from '@/features/health/pharmacy/types';

export default function StockAlertsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useStockAlerts();

  const alerts = data ?? [];
  const outCount = alerts.filter((a) => a.severity === 'out').length;
  const lowCount = alerts.filter((a) => a.severity === 'low').length;

  const renderRow = ({ item }: { item: StockAlert }) => {
    const isOut = item.severity === 'out';
    const iconBg = isOut ? Colors.iconBgRed : Colors.iconBgGold;
    const iconColor = isOut ? Colors.error : Colors.onWarning;
    const pillBg = isOut ? Colors.errorContainer : Colors.iconBgGold;
    const pillColor = isOut ? Colors.error : Colors.onWarning;

    return (
      <View style={[styles.card, shadow1]}>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: iconBg }]}>
            {isOut ? (
              <BellRing size={18} color={iconColor} strokeWidth={2} />
            ) : (
              <Bell size={18} color={iconColor} strokeWidth={2} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>
              {item.stock} in stock · reorder at {item.reorderLevel}
            </Text>
          </View>
          <View style={[styles.pill, { backgroundColor: pillBg }]}>
            <Text style={[styles.pillText, { color: pillColor }]}>{isOut ? 'Out of stock' : 'Low stock'}</Text>
          </View>
        </View>
        <Pressable
          style={styles.reorderBtn}
          onPress={() => router.push('/health/pharmacy/provider/catalog')}
        >
          <Text style={styles.reorderText}>Reorder</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Stock alerts" subtitle="Low & out-of-stock" />

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
                  <Text style={styles.summaryTitle}>Inventory needs attention</Text>
                  <Text style={styles.summaryMeta}>
                    {outCount} out of stock · {lowCount} low stock
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
              title="All stocked up"
              message="No low or out-of-stock items right now. Nice work keeping the shelves full."
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
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  pill: { alignSelf: 'flex-start', paddingHorizontal: Spacing.sm + 2, paddingVertical: 5, borderRadius: Radius.full },
  pillText: { ...Typography.labelSm, fontWeight: '700' as const },
  reorderBtn: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
  },
  reorderText: { ...Typography.labelMd, color: Colors.onPrimary },
});
