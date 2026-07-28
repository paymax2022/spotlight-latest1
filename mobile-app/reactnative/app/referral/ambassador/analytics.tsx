import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useAmbassadorAnalytics } from '@/features/referral/ambassador/hooks';

// M-AMB-04 — Performance analytics: trends over time, best channels.
export default function AmbassadorAnalyticsScreen() {
  const { data, isLoading, isError, refetch } = useAmbassadorAnalytics();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Performance analytics" />
      {isLoading ? (
        <StateView kind="loading" message="Loading analytics…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Best channel */}
          <View style={styles.bestCard}>
            <View style={styles.bestIcon}><TrendingUp size={20} color={Colors.tertiaryContainer} strokeWidth={2} /></View>
            <View>
              <Text style={styles.bestLabel}>Best converting channel</Text>
              <Text style={styles.bestValue}>{data.bestChannel}</Text>
            </View>
          </View>

          {/* Trend chart (bars) */}
          <Text style={styles.sectionTitle}>Clicks vs activations</Text>
          <View style={styles.chart}>
            <View style={styles.chartBars}>
              {data.trend.map((p) => {
                const max = Math.max(...data.trend.map((t) => t.clicks)) || 1;
                return (
                  <View key={p.label} style={styles.barCol}>
                    <View style={styles.barStack}>
                      <View style={[styles.barClicks, { height: `${Math.round((p.clicks / max) * 100)}%` }]} />
                      <View style={[styles.barActs, { height: `${Math.round((p.activations / max) * 100)}%` }]} />
                    </View>
                    <Text style={styles.barLabel}>{p.label}</Text>
                  </View>
                );
              })}
            </View>
            <View style={styles.legend}>
              <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: Colors.primary }]} /><Text style={styles.legendText}>Clicks</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: Colors.teal }]} /><Text style={styles.legendText}>Activations</Text></View>
            </View>
          </View>

          {/* Channels */}
          <Text style={styles.sectionTitle}>Channel performance</Text>
          <View style={styles.channels}>
            {data.channels.map((c, i) => (
              <View key={c.channel} style={[styles.channelRow, i < data.channels.length - 1 && styles.channelBorder]}>
                <View style={styles.channelBody}>
                  <Text style={styles.channelName}>{c.channel}</Text>
                  <Text style={styles.channelMeta}>{c.clicks.toLocaleString('en-NG')} clicks · {c.activations} activations</Text>
                </View>
                <View style={styles.rateChip}><Text style={styles.rateText}>{Math.round(c.rate * 100)}%</Text></View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  bestCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  bestIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  bestLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  bestValue: { ...Typography.titleMd, color: Colors.onSurface },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  chart: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  chartBars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', height: 140 },
  barCol: { alignItems: 'center', gap: 6, flex: 1 },
  barStack: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 110 },
  barClicks: { width: 10, borderRadius: Radius.sm, backgroundColor: Colors.primary, minHeight: 4 },
  barActs: { width: 10, borderRadius: Radius.sm, backgroundColor: Colors.teal, minHeight: 4 },
  barLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  legend: { flexDirection: 'row', gap: Spacing.md, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: Radius.full },
  legendText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  channels: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  channelBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  channelBody: { flex: 1 },
  channelName: { ...Typography.labelMd, color: Colors.onSurface },
  channelMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  rateChip: { backgroundColor: Colors.iconBgTeal, paddingHorizontal: Spacing.sm, paddingVertical: 5, borderRadius: Radius.full },
  rateText: { ...Typography.labelSm, color: Colors.tertiaryContainer, fontWeight: '700' as const },
});
