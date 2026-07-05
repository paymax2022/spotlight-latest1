import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { formatNaira } from '@/features/referral/constants/format';
import { useMerchantPerformance } from '@/features/referral/merchant/hooks';

// M-MER-03 — Campaign performance: conversions, spend, ROI.
export default function MerchantPerformanceScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? '';
  const { data, isLoading, isError, refetch } = useMerchantPerformance(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Campaign performance" />
      {isLoading ? (
        <StateView kind="loading" message="Loading performance…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.campName}>{data.campaignName}</Text>

          {/* KPI grid */}
          <View style={styles.kpiGrid}>
            <View style={styles.kpi}><Text style={styles.kpiValue}>{data.conversions}</Text><Text style={styles.kpiLabel}>Conversions</Text></View>
            <View style={styles.kpi}><Text style={styles.kpiValue}>{formatNaira(data.spentKobo)}</Text><Text style={styles.kpiLabel}>Spent</Text></View>
            <View style={styles.kpi}><Text style={styles.kpiValue}>{formatNaira(data.costPerConversionKobo)}</Text><Text style={styles.kpiLabel}>Cost / conv.</Text></View>
            <View style={styles.kpi}><Text style={styles.kpiValue}>{data.roas.toFixed(1)}x</Text><Text style={styles.kpiLabel}>Return on spend</Text></View>
          </View>

          {/* Budget usage */}
          <View style={styles.budgetCard}>
            <View style={styles.budgetTop}>
              <Text style={styles.budgetLabel}>Budget used</Text>
              <Text style={styles.budgetValue}>{formatNaira(data.spentKobo)} / {formatNaira(data.budgetKobo)}</Text>
            </View>
            <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, Math.round((data.spentKobo / (data.budgetKobo || 1)) * 100))}%` }]} /></View>
          </View>

          {/* ROAS callout */}
          <View style={styles.roasCard}>
            <View style={styles.roasIcon}><TrendingUp size={20} color={Colors.tertiaryContainer} strokeWidth={2} /></View>
            <Text style={styles.roasText}>Every ₦1 spent returned ₦{data.roas.toFixed(1)} in verified customer value.</Text>
          </View>

          {/* Series chart */}
          <Text style={styles.sectionTitle}>Conversions over time</Text>
          <View style={styles.chart}>
            {data.series.map((p) => {
              const max = Math.max(...data.series.map((s) => s.conversions)) || 1;
              return (
                <View key={p.label} style={styles.barCol}>
                  <View style={styles.barWrap}><View style={[styles.bar, { height: `${Math.round((p.conversions / max) * 100)}%` }]} /></View>
                  <Text style={styles.barValue}>{p.conversions}</Text>
                  <Text style={styles.barLabel}>{p.label}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  campName: { ...Typography.headlineMd, color: Colors.onSurface },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  kpi: { width: '48%', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 2 },
  kpiValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '800' as const },
  kpiLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  budgetCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  budgetTop: { flexDirection: 'row', justifyContent: 'space-between' },
  budgetLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  budgetValue: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
  track: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.primary },
  roasCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md },
  roasIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  roasText: { ...Typography.bodyMd, color: Colors.tertiaryContainer, flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  chart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, height: 180 },
  barCol: { alignItems: 'center', gap: 4, flex: 1 },
  barWrap: { height: 110, justifyContent: 'flex-end' },
  bar: { width: 22, borderRadius: Radius.sm, backgroundColor: Colors.primary, minHeight: 4 },
  barValue: { ...Typography.labelSm, color: Colors.onSurface },
  barLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
