import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Landmark, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useEarnings } from '@/features/restaurantmerchant/hooks';
import type { EarningsRun } from '@/features/restaurantmerchant/types';

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;
const STATUS_TINT: Record<string, string> = {
  paid: Colors.tertiaryContainer,
  processing: Colors.secondary,
  draft: Colors.onSurfaceVariant,
  failed: Colors.error,
};

export default function EarningsScreen() {
  const earnings = useEarnings();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Earnings" />
      {earnings.isLoading ? (
        <StateView kind="loading" title="Loading earnings" />
      ) : earnings.isError ? (
        <StateView kind="error" title="Couldn't load earnings"
          actionLabel="Retry" onAction={() => earnings.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.statsRow}>
            <Stat label="Paid out" value={naira(earnings.data?.paidOutKobo ?? 0)} tint={Colors.primary} />
            <Stat label="Pending" value={naira(earnings.data?.pendingKobo ?? 0)} tint={Colors.secondary} />
          </View>
          <Text style={styles.note}>
            Pending earnings are settled orders awaiting the next payout run. Paid-out funds are credited to your wallet.
          </Text>

          <Pressable onPress={() => router.push('/food/restaurant/bank-accounts')} style={styles.linkBtn}>
            <Landmark size={18} color={Colors.primary} />
            <Text style={styles.linkText}>Manage payout accounts</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} />
          </Pressable>

          <Text style={styles.section}>Payout history</Text>
          {(earnings.data?.runs.length ?? 0) === 0 ? (
            <StateView kind="empty" compact icon="Receipt" title="No payouts yet"
              message="Your payout runs will appear here once orders are settled and disbursed." />
          ) : (
            <View style={styles.card}>
              {earnings.data?.runs.map((r, i) => <RunRow key={r.id} run={r} first={i === 0} />)}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color: tint }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function RunRow({ run, first }: { run: EarningsRun; first: boolean }) {
  const tint = STATUS_TINT[run.status] ?? Colors.onSurfaceVariant;
  return (
    <View style={[styles.runRow, !first && styles.runRowBorder]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.runPeriod}>{run.periodKey}</Text>
        <Text style={[styles.runStatus, { color: tint }]}>{run.status}</Text>
      </View>
      <Text style={styles.runAmount}>{naira(run.netKobo)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl },
  statsRow: { flexDirection: 'row', gap: Spacing.md },
  stat: {
    flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 6,
  },
  statLabel: { color: Colors.onSurfaceVariant, fontSize: 13, fontWeight: '600' },
  statValue: { fontSize: 22, fontWeight: '800' },
  note: { color: Colors.onSurfaceVariant, fontSize: 13 },
  linkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, paddingVertical: 14,
  },
  linkText: { color: Colors.primary, fontSize: 15, fontWeight: '700', flex: 1 },
  section: { color: Colors.onSurface, fontSize: 16, fontWeight: '700', marginTop: Spacing.sm },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md,
  },
  runRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  runRowBorder: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  runPeriod: { color: Colors.onSurface, fontSize: 15, fontWeight: '600' },
  runStatus: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize', marginTop: 2 },
  runAmount: { color: Colors.onSurface, fontSize: 16, fontWeight: '700' },
});
