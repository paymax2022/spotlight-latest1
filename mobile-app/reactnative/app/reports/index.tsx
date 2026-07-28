import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useReports } from '@/features/reports/hooks';
import { SECTION_ICON } from '@/features/reports/api';
import type { ReportSection } from '@/features/reports/api';

export default function ReportsScreen() {
  const { data, isLoading, isError, refetch } = useReports();

  if (isLoading) return <Wrap><StateView kind="loading" message="Building reports…" /></Wrap>;
  if (isError || !data) return <Wrap><StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} /></Wrap>;

  return (
    <Wrap>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {data.sections.map((s: ReportSection) => {
          const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[SECTION_ICON[s.id] ?? 'FileBarChart'] ?? Icons.FileBarChart;
          return (
            <View key={s.id} style={styles.card}>
              <View style={styles.head}>
                <View style={styles.iconBox}><Icon size={18} color={Colors.primary} strokeWidth={1.8} /></View>
                <Text style={styles.title}>{s.title}</Text>
              </View>
              <View style={styles.metrics}>
                {s.metrics.map((m, i) => (
                  <View key={i} style={styles.metric}>
                    <Text style={styles.metricValue} numberOfLines={1}>{m.value}</Text>
                    <Text style={styles.metricLabel} numberOfLines={1}>{m.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reports" subtitle="Estate analytics" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: Spacing.md, ...shadow1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBox: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  metric: { width: '47%', flexGrow: 1, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, gap: 2 },
  metricValue: { ...Typography.titleMd, color: Colors.onSurface },
  metricLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
