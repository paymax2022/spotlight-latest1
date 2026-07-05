import React from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import Svg, { Polyline } from 'react-native-svg';
import { FileText, TrendingUp, Coins } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useHolding } from '@/features/fractionalre/hooks';
import { formatNaira, formatNairaCompact, formatYield, relativeDate } from '@/features/fractionalre/utils';
import { KIND_LABEL } from '@/features/fractionalre/constants';

export default function HoldingDetail() {
  const { holdingId } = useLocalSearchParams<{ holdingId: string }>();
  const holding = useHolding(holdingId);

  if (holding.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Holding" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  const h = holding.data;
  if (!h) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Holding" />
        <StateView kind="error" title="Not found" message="This holding is unavailable." />
      </SafeAreaView>
    );
  }

  const gain = h.currentValueKobo - h.investedKobo;
  const vals = h.performance.map((p) => p.valueKobo);
  const min = Math.min(...vals, h.investedKobo);
  const max = Math.max(...vals, h.currentValueKobo);
  const W = 300, H = 80;
  const pts = h.performance.map((p, i) => {
    const x = (i / Math.max(1, h.performance.length - 1)) * W;
    const y = H - ((p.valueKobo - min) / Math.max(1, max - min)) * H;
    return `${x},${y}`;
  }).join(' ');

  const onSell = () => router.push({ pathname: '/fractionalre/market/list', params: { holdingId: h.id } } as never);
  const onReinvest = () => Alert.alert('Reinvest', 'Auto-reinvest of payouts can be configured under Auto-invest.', [
    { text: 'Open Auto-invest', onPress: () => router.push('/fractionalre/portfolio/auto-invest') },
    { text: 'Close', style: 'cancel' },
  ]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={KIND_LABEL[h.kind]} subtitle={h.title} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Image source={{ uri: h.coverImageUrl }} style={styles.cover} />

        <View style={styles.valueRow}>
          <View>
            <Text style={styles.valueLabel}>Current value</Text>
            <Text style={styles.value}>{formatNaira(h.currentValueKobo)}</Text>
          </View>
          <View style={styles.gainPill}>
            <TrendingUp size={14} color={gain >= 0 ? Colors.teal : Colors.error} strokeWidth={2} />
            <Text style={[styles.gainText, { color: gain >= 0 ? Colors.teal : Colors.error }]}>
              {gain >= 0 ? '+' : ''}{formatNairaCompact(gain)}
            </Text>
          </View>
        </View>

        {/* Performance */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Performance</Text>
          <Svg width={W} height={H}>
            <Polyline points={pts} fill="none" stroke={gain >= 0 ? Colors.teal : Colors.error} strokeWidth={2.5} />
          </Svg>
          <View style={styles.metricsRow}>
            <Metric label="Invested" value={formatNairaCompact(h.investedKobo)} />
            <Metric label="Units" value={String(h.units)} />
            <Metric label="Proj. yield" value={formatYield(h.projectedYieldBps)} />
            <Metric label="NAV/unit" value={formatNaira(h.navPerUnitKobo)} />
          </View>
        </View>

        {/* Payout history */}
        <Section title="Payout history">
          {h.payouts.length === 0 ? (
            <Text style={styles.muted}>No payouts yet.</Text>
          ) : h.payouts.map((p) => (
            <View key={p.id} style={styles.payRow}>
              <Coins size={16} color={Colors.teal} strokeWidth={2} />
              <View style={styles.payText}>
                <Text style={styles.payAmount}>{formatNaira(p.amountKobo)}</Text>
                <Text style={styles.paySub}>{p.kind} · {p.status === 'paid' ? relativeDate(p.paidAt) : `due ${relativeDate(p.dueAt)}`}</Text>
              </View>
            </View>
          ))}
        </Section>

        {/* Updates */}
        <Section title="Updates">
          {h.updates.map((u) => (
            <View key={u.id} style={styles.update}>
              <Text style={styles.updateDate}>{relativeDate(u.date)}</Text>
              <Text style={styles.updateTitle}>{u.title}</Text>
              <Text style={styles.updateBody}>{u.body}</Text>
            </View>
          ))}
        </Section>

        {/* Documents */}
        <Section title="Documents">
          {h.documents.map((d) => (
            <View key={d.id} style={styles.docRow}>
              <FileText size={16} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.docLabel} numberOfLines={1}>{d.label}</Text>
              <Text style={styles.docSize}>{d.sizeKb} KB</Text>
            </View>
          ))}
        </Section>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <View style={styles.footerRow}>
          <PrimaryButton label="Sell / list" variant="secondary" onPress={onSell} style={styles.flexBtn} />
          <PrimaryButton label="Reinvest" onPress={onReinvest} style={styles.flexBtn} />
        </View>
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricVal}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xl, gap: Spacing.md },
  cover: { width: '100%', height: 170, backgroundColor: Colors.surfaceContainerHigh },
  valueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.containerMargin },
  valueLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  value: { ...Typography.headlineMd, color: Colors.onSurface },
  gainPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 6 },
  gainText: { ...Typography.labelMd, fontWeight: '600' },
  card: { marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  metric: { width: '42%' },
  metricVal: { ...Typography.labelLg, color: Colors.onSurface },
  metricLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  section: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  muted: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  payText: { flex: 1 },
  payAmount: { ...Typography.labelLg, color: Colors.onSurface },
  paySub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'capitalize' },
  update: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, gap: 2 },
  updateDate: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  updateTitle: { ...Typography.labelLg, color: Colors.onSurface },
  updateBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  docLabel: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  docSize: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  footerRow: { flexDirection: 'row', gap: Spacing.sm },
  flexBtn: { flex: 1 },
});
