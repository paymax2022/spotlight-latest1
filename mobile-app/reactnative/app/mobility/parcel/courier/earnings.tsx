import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Package } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useParcels } from '@/features/mobility/hooks/useModes';
import { formatNaira, formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';

export default function CourierEarningsScreen() {
  const parcels = useParcels();

  const delivered = (parcels.data ?? []).filter((p) => p.phase === 'delivered');
  const grossKobo = delivered.reduce((sum, p) => sum + p.fareKobo, 0);
  const netKobo = Math.round(grossKobo * 0.8);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Courier earnings" />
      {parcels.isLoading ? (
        <StateView kind="loading" message="Loading earnings…" />
      ) : parcels.isError ? (
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => parcels.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={[styles.summary, shadow1]}>
            <Text style={styles.summaryLabel}>Net earnings</Text>
            <Text style={styles.summaryValue}>{formatNaira(netKobo)}</Text>
            <View style={styles.summaryRow}>
              <View style={styles.summaryCol}><Text style={styles.colLabel}>Gross</Text><Text style={styles.colValue}>{formatNairaWhole(grossKobo)}</Text></View>
              <View style={styles.summaryCol}><Text style={styles.colLabel}>Deliveries</Text><Text style={styles.colValue}>{delivered.length}</Text></View>
              <View style={styles.summaryCol}><Text style={styles.colLabel}>Commission</Text><Text style={styles.colValue}>20%</Text></View>
            </View>
          </View>

          <Text style={styles.section}>Recent deliveries</Text>
          {delivered.length === 0 ? (
            <MobilityEdgeState kind="empty" compact title="No deliveries yet" message="Completed deliveries will show here." />
          ) : (
            delivered.map((p) => (
              <View key={p.id} style={styles.row}>
                <View style={styles.rowIcon}><Package size={18} color={Colors.primary} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{p.dropoff.address}</Text>
                  <Text style={styles.rowMeta}>Delivered</Text>
                </View>
                <Text style={styles.rowNet}>+{formatNairaWhole(Math.round(p.fareKobo * 0.8))}</Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  summary: { backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.lg, gap: 4 },
  summaryLabel: { ...Typography.labelMd, color: Colors.inversePrimary },
  summaryValue: { ...Typography.displayLg, color: Colors.onPrimary, fontSize: 36, lineHeight: 42 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.md },
  summaryCol: { gap: 2 },
  colLabel: { ...Typography.labelSm, color: Colors.inversePrimary },
  colValue: { ...Typography.labelLg, color: Colors.onPrimary },
  section: { ...Typography.labelLg, color: Colors.onSurface },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  rowIcon: { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...Typography.labelMd, color: Colors.onSurface },
  rowMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rowNet: { ...Typography.labelLg, color: Colors.tertiaryContainer, fontWeight: '700' as const },
});
