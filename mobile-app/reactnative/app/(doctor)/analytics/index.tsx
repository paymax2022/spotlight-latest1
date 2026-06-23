import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { TrendingUp, TrendingDown, Minus, Award } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow2 } from '@/constants/shadows';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, BarRow } from '@/features/doctor/components';
import { useQualityAnalytics } from '@/features/doctor/hooks';
import { ANALYTICS_PERIOD_OPTIONS } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.phase3.api';
import type { AnalyticsPeriod, AnalyticsMetric } from '@/types/doctor.phase3';

export default function QualityAnalyticsScreen() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('30d');
  const { data, isLoading, isError, refetch } = useQualityAnalytics(period);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Quality Analytics" />

      {isLoading && !data ? (
        <StateView variant="loading" label="Loading analytics" />
      ) : isError || !data ? (
        <StateView variant="error" message="We could not load your analytics." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Period selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {ANALYTICS_PERIOD_OPTIONS.map((p) => {
              const active = period === p.value;
              return (
                <Pressable key={p.value} onPress={() => setPeriod(p.value)} style={[styles.filterChip, active && styles.filterChipOn]} accessibilityRole="button" accessibilityLabel={p.label}>
                  <Text style={[styles.filterText, active && styles.filterTextOn]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Ranking hero */}
          <LinearGradient colors={[Colors.primary, Colors.primaryContainer]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow2]}>
            <View style={styles.heroIcon}>
              <Award size={24} color={Colors.onPrimary} strokeWidth={2} />
            </View>
            <View style={styles.heroBody}>
              <Text style={styles.heroPct}>Top {100 - data.rankingPercentile}%</Text>
              <Text style={styles.heroLabel}>{data.rankingLabel}</Text>
            </View>
          </LinearGradient>

          {/* Metric tiles */}
          <View style={styles.metricGrid}>
            {data.metrics.map((m) => <MetricTile key={m.key} metric={m} />)}
          </View>

          <SectionCard title="Rating trend" style={styles.card}>
            <BarRow points={data.ratingTrend} tint={Colors.primary} />
          </SectionCard>

          <SectionCard title="Avg response time (mins)" style={styles.card}>
            <BarRow points={data.responseTimeTrend} tint={Colors.secondary} formatValue={(v) => `${v}m`} />
          </SectionCard>

          <SectionCard title="Consult volume" style={styles.card}>
            <BarRow points={data.consultVolume} tint={Colors.teal} />
          </SectionCard>

          <SectionCard title="Earnings trend" style={styles.card}>
            <BarRow points={data.earningsTrend} tint={Colors.primary} formatValue={formatKobo} />
          </SectionCard>

          <SectionCard title="Completion rate" style={styles.card}>
            <View style={styles.completion}>
              <View style={styles.completionTrack}>
                <View style={[styles.completionFill, { width: `${data.completionRate}%` }]} />
              </View>
              <Text style={styles.completionValue}>{data.completionRate}%</Text>
            </View>
          </SectionCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MetricTile({ metric }: { metric: AnalyticsMetric }) {
  const TrendIcon = metric.trend === 'up' ? TrendingUp : metric.trend === 'down' ? TrendingDown : Minus;
  const trendColor = metric.isGood ? Colors.teal : Colors.error;
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel} numberOfLines={1}>{metric.label}</Text>
      <Text style={styles.tileValue} numberOfLines={1}>{metric.value}{metric.unit ? ` ${metric.unit}` : ''}</Text>
      <View style={styles.tileTrend}>
        <TrendIcon size={13} color={trendColor} strokeWidth={2.2} />
        <Text style={[styles.tileDelta, { color: trendColor }]}>{metric.deltaPct > 0 ? '+' : ''}{metric.deltaPct}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: Colors.background },
  content:         { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  filters:         { gap: Spacing.sm, paddingBottom: Spacing.md },
  filterChip:      { height: 36, paddingHorizontal: Spacing.md, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  filterChipOn:    { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText:      { ...Typography.labelMd, color: Colors.onSurface },
  filterTextOn:    { color: Colors.onPrimary },
  hero:            { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderRadius: Radius.xl, padding: Spacing.cardPadding, marginBottom: Spacing.md },
  heroIcon:        { width: 48, height: 48, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  heroBody:        { flex: 1, gap: 2 },
  heroPct:         { ...Typography.headlineMd, color: Colors.onPrimary },
  heroLabel:       { ...Typography.bodySm, color: 'rgba(255,255,255,0.85)' },
  metricGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginBottom: Spacing.md },
  tile:            { width: '47%', flexGrow: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.xs, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  tileLabel:       { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  tileValue:       { ...Typography.titleLg, color: Colors.onSurface, fontWeight: '700' },
  tileTrend:       { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tileDelta:       { ...Typography.labelSm, fontWeight: '700' },
  card:            { marginBottom: Spacing.md },
  completion:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  completionTrack: { flex: 1, height: 12, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  completionFill:  { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.teal },
  completionValue: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' },
});
