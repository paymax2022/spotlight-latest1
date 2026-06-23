import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogIn, Gauge, Ban, CloudUpload } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import MetricBar from '@/features/visitor/components/MetricBar';
import { VisitorColors } from '@/features/visitor/constants/visitor.constants';
import { useVisitorAnalytics } from '@/features/visitor/hooks/useVisitor';

export default function GateAnalyticsScreen() {
  const { data, isLoading, isError, refetch } = useVisitorAnalytics();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Gate analytics" />
        <StateView kind="loading" message="Crunching gate numbers…" />
      </SafeAreaView>
    );
  }
  if (isError || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Gate analytics" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      </SafeAreaView>
    );
  }

  const maxHour = Math.max(...data.byHour.map((h) => h.value));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Gate analytics" subtitle={data.rangeLabel} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.kpiGrid}>
          <Kpi icon={<LogIn size={18} color={VisitorColors.success} />} bg={VisitorColors.successBg} value={String(data.totalEntries)} label="Entries" />
          <Kpi icon={<Gauge size={18} color={Colors.secondary} />} bg={Colors.iconBgBlue} value={`${data.avgVerificationSeconds}s`} label="Avg verify" />
          <Kpi icon={<Ban size={18} color={Colors.error} />} bg={Colors.errorContainer} value={String(data.totalDenials)} label="Denials" />
          <Kpi icon={<CloudUpload size={18} color={Colors.teal} />} bg={Colors.iconBgTeal} value={`${data.offlineSyncedPct}%`} label="Synced" />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Throughput by hour</Text>
          {data.byHour.map((h) => (
            <MetricBar key={h.hour} label={h.hour} value={h.value} max={maxHour} color={Colors.primary} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Kpi({ icon, bg, value, label }: { icon: React.ReactNode; bg: string; value: string; label: string }) {
  return (
    <View style={styles.kpi}>
      <View style={[styles.kpiIcon, { backgroundColor: bg }]}>{icon}</View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  kpi: { flexBasis: '47%', flexGrow: 1, gap: 2, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  kpiIcon: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  kpiValue: { ...Typography.headlineMd, color: Colors.onSurface },
  kpiLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: 2, ...shadow1 },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: Spacing.xs },
});
