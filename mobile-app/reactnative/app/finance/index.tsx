import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TrendingUp, Wallet, AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useFinanceDashboard } from '@/features/finance/hooks';
import { CATEGORY_LABELS } from '@/features/finance/api';
import { formatNairaFromKobo, relativeTime } from '@/features/visitor/utils/visitorFormatters';

export default function FinanceScreen() {
  const { data, isLoading, isError, refetch } = useFinanceDashboard();

  if (isLoading) return <Wrap><StateView kind="loading" message="Loading finances…" /></Wrap>;
  if (isError || !data) return <Wrap><StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} /></Wrap>;

  const maxCat = Math.max(1, ...data.byCategory.map((c) => c.amountKobo));

  return (
    <Wrap>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Collected this month</Text>
          <Text style={styles.heroValue}>{formatNairaFromKobo(data.collectedThisMonthKobo)}</Text>
          <Text style={styles.heroSub}>{formatNairaFromKobo(data.collectedTotalKobo)} all-time</Text>
        </View>

        <View style={styles.row}>
          <MiniStat icon={<AlertCircle size={18} color={Colors.error} strokeWidth={1.8} />} label="Outstanding" value={formatNairaFromKobo(data.outstandingKobo)} />
          <MiniStat icon={<TrendingUp size={18} color={Colors.teal} strokeWidth={1.8} />} label="Collection rate" value={`${data.collectionRate}%`} />
        </View>

        <Text style={styles.section}>Collected by category</Text>
        <View style={styles.card}>
          {data.byCategory.length === 0 ? <Text style={styles.empty}>No payments yet.</Text> : data.byCategory.map((c) => (
            <View key={c.category} style={styles.barRow}>
              <View style={styles.barHead}>
                <Text style={styles.barLabel}>{CATEGORY_LABELS[c.category] ?? c.category}</Text>
                <Text style={styles.barValue}>{formatNairaFromKobo(c.amountKobo)}</Text>
              </View>
              <View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.round((c.amountKobo / maxCat) * 100)}%` }]} /></View>
            </View>
          ))}
        </View>

        <Text style={styles.section}>Recent payments</Text>
        <View style={styles.card}>
          {data.recentPayments.length === 0 ? <Text style={styles.empty}>No payments yet.</Text> : data.recentPayments.map((p, i) => (
            <View key={p.id} style={[styles.payRow, i > 0 && styles.payRowBorder]}>
              <View style={styles.payIcon}><Wallet size={16} color={Colors.primary} strokeWidth={1.8} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.payName} numberOfLines={1}>{p.payerName ?? 'Resident'}</Text>
                <Text style={styles.payMeta}>{p.method} · {relativeTime(p.createdAt)}</Text>
              </View>
              <Text style={styles.payAmount}>{formatNairaFromKobo(p.amountKobo)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </Wrap>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.mini}>
      {icon}
      <Text style={styles.miniValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Finance" subtitle="Estate collections" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.lg, ...shadow1 },
  heroLabel: { ...Typography.labelMd, color: Colors.onPrimary, opacity: 0.85 },
  heroValue: { ...Typography.displayLg, color: Colors.onPrimary, marginTop: 4 },
  heroSub: { ...Typography.bodySm, color: Colors.onPrimary, opacity: 0.8, marginTop: 2 },
  row: { flexDirection: 'row', gap: Spacing.md },
  mini: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: 4, ...shadow1 },
  miniValue: { ...Typography.titleMd, color: Colors.onSurface },
  miniLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: Spacing.md, ...shadow1 },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  barRow: { gap: 6 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between' },
  barLabel: { ...Typography.labelMd, color: Colors.onSurface },
  barValue: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  barTrack: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.primary },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.sm },
  payRowBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
  payIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  payName: { ...Typography.labelMd, color: Colors.onSurface },
  payMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  payAmount: { ...Typography.labelLg, color: Colors.onSurface },
});
