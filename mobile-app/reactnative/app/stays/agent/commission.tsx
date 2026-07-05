import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Percent, Wallet, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useCommissionSummary } from '@/features/stays/agent';
import { formatNaira, StaysColors } from '@/features/stays/constants/stays.constants';

/** Agent: commission view (PRD §20.8). */
export default function CommissionScreen() {
  const summary = useCommissionSummary();

  if (summary.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Commission" />
        <StateView kind="loading" message="Loading commission…" />
      </SafeAreaView>
    );
  }
  if (summary.isError || !summary.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Commission" />
        <StateView kind="error" title="Couldn't load commission" actionLabel="Retry" onAction={() => summary.refetch()} />
      </SafeAreaView>
    );
  }

  const s = summary.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Commission" subtitle={s.monthLabel} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Percent size={24} color={Colors.onPrimary} /></View>
          <Text style={styles.heroLabel}>Total commission earned</Text>
          <Text style={styles.heroVal}>{formatNaira(s.commissionKobo)}</Text>
          <Text style={styles.heroSub}>{s.bookingsCount} confirmed booking{s.bookingsCount === 1 ? '' : 's'} this month</Text>
        </View>

        <View style={styles.grid}>
          <Stat icon={<TrendingUp size={18} color={Colors.primary} />} label="Gross sales" value={formatNaira(s.grossSalesKobo)} />
          <Stat icon={<Wallet size={18} color={StaysColors.ok} />} label="Float balance" value={formatNaira(s.floatBalanceKobo)} />
        </View>

        <View style={styles.payoutCard}>
          <Text style={styles.payoutTitle}>Payout status</Text>
          <Row label="Paid out" value={formatNaira(s.paidKobo)} ok />
          <Row label="Pending" value={formatNaira(s.pendingKobo)} />
          <Text style={styles.payoutNote}>Commission is paid once each booking is confirmed and reconciled.</Text>
        </View>

        <PrimaryButton label="View bookings" variant="secondary" onPress={() => router.push('/stays/agent/book')} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statIcon}>{icon}</View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statVal}>{value}</Text>
    </View>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowVal, ok && { color: Colors.teal }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.lg, alignItems: 'center', gap: 2 },
  heroIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  heroLabel: { ...Typography.labelMd, color: Colors.onPrimary },
  heroVal: { ...Typography.headlineMd, color: Colors.onPrimary, fontWeight: '800' as const },
  heroSub: { ...Typography.caption, color: Colors.inversePrimary },
  grid: { flexDirection: 'row', gap: Spacing.sm },
  stat: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 4 },
  statIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  statLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  statVal: { ...Typography.titleMd, color: Colors.onSurface, fontWeight: '700' as const },
  payoutCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  payoutTitle: { ...Typography.titleMd, color: Colors.onSurface },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  rowVal: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '700' as const },
  payoutNote: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 4 },
});
