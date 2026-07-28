import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TierLimitBar from '@/features/connect/components/TierLimitBar';
import { formatKobo } from '@/features/connect/constants/format';
import type { TierLimitsRow } from '@/features/connect/wallet/types';
import { useTierLimits, useTierStatus } from '@/features/connect/wallet/hooks';

// WL-16 — Full CBN tier ladder with daily/limit deltas. Renders TierLimitBar
// for the user's CURRENT tier (live remaining), then the full reference table.
export default function TierLimits() {
  const limits = useTierLimits();
  const tierQ = useTierStatus();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Tier limits" subtitle="CBN three-tier KYC" />
      {limits.isLoading || tierQ.isLoading ? (
        <StateView kind="loading" message="Loading limits…" />
      ) : limits.error || !limits.data || !tierQ.data ? (
        <StateView kind="error" title="Couldn't load limits" actionLabel="Retry" onAction={() => limits.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
          <Text style={styles.caption}>Your current tier</Text>
          <TierLimitBar tier={tierQ.data} />

          <Text style={styles.sectionTitle}>All tiers</Text>
          {limits.data.map((row) => (
            <TierCard key={row.tier} row={row} current={row.tier === tierQ.data!.tier} />
          ))}

          <Text style={styles.disclaimer}>
            Limits mirror Central Bank of Nigeria KYC tiers. The server is the source of truth for
            all limit checks — these figures are for reference.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function TierCard({ row, current }: { row: TierLimitsRow; current: boolean }) {
  return (
    <View style={[styles.card, current && styles.cardCurrent]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{row.label}</Text>
        {current ? <View style={styles.currentBadge}><Text style={styles.currentBadgeText}>Current</Text></View> : null}
      </View>
      <Text style={styles.cardReq}>{row.requirement}</Text>
      <View style={styles.limitRows}>
        <LimitRow label="Daily limit" value={row.dailyLimitKobo == null ? 'No fixed limit' : row.dailyLimitKobo === 0 ? 'No money movement' : formatKobo(row.dailyLimitKobo)} />
        <LimitRow label="Max single gift" value={row.singleGiftMaxKobo == null ? 'No limit' : row.singleGiftMaxKobo === 0 ? '—' : formatKobo(row.singleGiftMaxKobo)} />
        <LimitRow label="Daily withdrawal" value={row.withdrawDailyKobo == null ? 'No limit' : !row.withdrawDailyKobo ? 'Not available' : formatKobo(row.withdrawDailyKobo)} />
      </View>
    </View>
  );
}

function LimitRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.limitRow}>
      <Text style={styles.limitLabel}>{label}</Text>
      <Text style={styles.limitValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40, gap: Spacing.md },
  caption: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.xs },
  cardCurrent: { borderColor: Colors.primary },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  currentBadge: { backgroundColor: Colors.iconBgPurple, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full },
  currentBadgeText: { ...Typography.labelSm, color: Colors.primary },
  cardReq: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  limitRows: { marginTop: Spacing.xs, gap: Spacing.xs },
  limitRow: { flexDirection: 'row', justifyContent: 'space-between' },
  limitLabel: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  limitValue: { ...Typography.labelMd, color: Colors.onSurface },
  disclaimer: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
});
