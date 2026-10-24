import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Package } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import StateView from '@/components/StateView';
import ScreenHeader from '@/components/ScreenHeader';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { errKind } from '@/features/mobility/utils/errKind';
import { useCourierHistory } from '@/features/mobility/hooks/useModes';
import { formatNaira, formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';
import { summariseCourierEarnings } from '@/features/mobility/utils/parcelWire';

// The rider's own deliveries and what the server says they were paid. No
// client-side commission: a net the server didn't report is shown as
// unavailable, and with no history endpoint the screen says so.
export default function CourierEarningsScreen() {
  const history = useCourierHistory();
  const summary = history.data ? summariseCourierEarnings(history.data) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Courier earnings" />
      {history.isLoading ? (
        <StateView kind="loading" message="Loading earnings…" />
      ) : history.isError ? (
        <MobilityEdgeState kind={errKind(history.error)} actionLabel="Retry" onAction={() => history.refetch()} />
      ) : !summary ? (
        <MobilityEdgeState
          kind="empty"
          title="Earnings aren't available yet"
          message="Your delivery history can't be shown in the app yet. Payouts for completed deliveries still go to your wallet."
          actionLabel="Retry"
          onAction={() => history.refetch()}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={[styles.summary, shadow1]}>
            <Text style={styles.summaryLabel}>Net earnings</Text>
            <Text style={styles.summaryValue}>{summary.netKobo != null ? formatNaira(summary.netKobo) : '—'}</Text>
            <View style={styles.summaryRow}>
              <View style={styles.summaryCol}><Text style={styles.colLabel}>Fares</Text><Text style={styles.colValue}>{formatNairaWhole(summary.grossKobo)}</Text></View>
              <View style={styles.summaryCol}><Text style={styles.colLabel}>Deliveries</Text><Text style={styles.colValue}>{summary.delivered.length}</Text></View>
            </View>
          </View>

          <Text style={styles.section}>Recent deliveries</Text>
          {summary.delivered.length === 0 ? (
            <MobilityEdgeState kind="empty" compact title="No deliveries yet" message="Completed deliveries will show here." />
          ) : (
            summary.delivered.map((d) => (
              <View key={d.parcelId} style={styles.row}>
                <View style={styles.rowIcon}><Package size={18} color={Colors.primary} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{d.dropoff.address || 'Delivery'}</Text>
                  <Text style={styles.rowMeta}>Delivered · fare {formatNairaWhole(d.fareKobo)}</Text>
                </View>
                <Text style={styles.rowNet}>{d.netKobo != null ? `+${formatNairaWhole(d.netKobo)}` : '—'}</Text>
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
  summaryValue: { ...Typography.displayLg, color: Colors.onPrimary, fontSize: 36, letterSpacing: -0.72, lineHeight: 42 },
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
