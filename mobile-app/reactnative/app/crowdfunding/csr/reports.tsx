import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Users, HandCoins, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useImpactSummary } from '@/features/crowdfunding/hooks/useCsr';
import { formatNaira, formatNairaCompact } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function CsrReportsScreen() {
  const { data: s, isLoading, isError, refetch } = useImpactSummary();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Impact report" subtitle="Your CSR contribution at a glance" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !s ? (
        <StateView kind="error" title="Couldn't load report" actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* Headline */}
          <View style={styles.headline}>
            <Text style={styles.headlineValue}>{formatNaira(s.totalMatchedKobo)}</Text>
            <Text style={styles.headlineLabel}>matched across {s.campaignsSupported} campaigns</Text>
          </View>

          <View style={styles.kpiRow}>
            <Kpi icon={<Users size={16} color={Colors.secondary} strokeWidth={2} />} value={s.livesImpacted.toLocaleString('en-NG')} label="Lives impacted" />
            <Kpi icon={<HandCoins size={16} color={Colors.teal} strokeWidth={2} />} value={String(s.campaignsSupported)} label="Campaigns" />
            <Kpi icon={<Sparkles size={16} color={Colors.primary} strokeWidth={2} />} value={s.topCategory} label="Top cause" />
          </View>

          {/* By category */}
          <Text style={styles.sectionTitle}>By category</Text>
          <View style={styles.card}>
            {s.byCategory.map((c) => {
              const max = Math.max(...s.byCategory.map((x) => x.matchedKobo), 1);
              return (
                <View key={c.category} style={styles.catRow}>
                  <View style={styles.catHead}><Text style={styles.catName}>{c.category}</Text><Text style={styles.catValue}>{formatNairaCompact(c.matchedKobo)}</Text></View>
                  <View style={styles.track}><View style={[styles.fill, { width: `${(c.matchedKobo / max) * 100}%` }]} /></View>
                </View>
              );
            })}
          </View>

          {/* Monthly */}
          <Text style={styles.sectionTitle}>Monthly matched</Text>
          <View style={styles.chartCard}>
            <View style={styles.chartRow}>
              {s.monthly.map((m, i) => {
                const max = Math.max(...s.monthly.map((x) => x.matchedKobo), 1);
                return (
                  <View key={i} style={styles.barCol}>
                    <View style={styles.barTrack}><View style={[styles.bar, { height: `${Math.max(4, (m.matchedKobo / max) * 100)}%` }]} /></View>
                    <Text style={styles.barLabel}>{m.month}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Kpi({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (<View style={styles.kpi}><View style={styles.kpiIcon}>{icon}</View><Text style={styles.kpiValue} numberOfLines={1}>{value}</Text><Text style={styles.kpiLabel}>{label}</Text></View>);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60 },
  headline: { alignItems: 'center', paddingVertical: Spacing.lg },
  headlineValue: { ...Typography.displayLg, fontSize: 36, lineHeight: 44, color: Colors.onSurface },
  headlineLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  kpiRow: { flexDirection: 'row', gap: Spacing.sm },
  kpi: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 4 },
  kpiIcon: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { ...Typography.titleMd, color: Colors.onSurface },
  kpiLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.md },
  catRow: { gap: 6 },
  catHead: { flexDirection: 'row', justifyContent: 'space-between' },
  catName: { ...Typography.labelMd, color: Colors.onSurface },
  catValue: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  track: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.secondary },
  chartCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 120, gap: Spacing.sm },
  barCol: { flex: 1, alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' },
  barTrack: { width: '100%', flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.sm, overflow: 'hidden' },
  bar: { width: '100%', backgroundColor: Colors.primary, borderRadius: Radius.sm },
  barLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
