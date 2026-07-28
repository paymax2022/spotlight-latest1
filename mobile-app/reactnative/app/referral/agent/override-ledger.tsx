import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { DisclosureCard } from '@/features/referral/components';
import { formatNaira, relativeTime } from '@/features/referral/constants/format';
import { useOverrideLedger } from '@/features/referral/agent/hooks';

// M-AGT-04 — Override earnings ledger: override % of verified network ACTIVITY,
// capped. Every row shows the verified-activity basis, the rate, the override,
// and whether the cap clipped it. Disclosure makes the activity basis explicit.
export default function OverrideLedgerScreen() {
  const { data, isLoading, isError, refetch } = useOverrideLedger();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Override ledger" />
      {isLoading ? (
        <StateView kind="loading" message="Loading ledger…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Summary */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryTop}>
              <View><Text style={styles.summaryLabel}>Total override</Text><Text style={styles.summaryValue}>{formatNaira(data.totalOverrideKobo)}</Text></View>
              <View style={styles.ratePill}><Text style={styles.rateText}>{Math.round(data.rate * 100)}% of activity</Text></View>
            </View>
            <Text style={styles.summaryBasis}>Computed on {formatNaira(data.totalActivityKobo)} of verified network activity (real transactions, not recruitment).</Text>
            <View style={styles.capRow}>
              <Text style={styles.capLabel}>Cap used this period</Text>
              <Text style={styles.capValue}>{formatNaira(data.capUsedKobo)} / {formatNaira(data.capKobo)}</Text>
            </View>
            <View style={styles.capTrack}><View style={[styles.capFill, { width: `${Math.min(100, Math.round((data.capUsedKobo / data.capKobo) * 100))}%` }]} /></View>
          </View>

          <DisclosureCard
            tone="compliant"
            title="What an override is"
            body="Each override below is a capped percentage of a member's VERIFIED activity and revenue. You are never paid for recruiting anyone — only when your network genuinely transacts on Paymax."
          />

          {/* Ledger rows */}
          <Text style={styles.sectionTitle}>Override entries</Text>
          {data.rows.length === 0 ? (
            <StateView kind="empty" icon="ScrollText" title="No overrides yet" message="Overrides appear as your network transacts." compact />
          ) : (
            <View style={styles.list}>
              {data.rows.map((r, i) => (
                <View key={r.id} style={[styles.row, i < data.rows.length - 1 && styles.rowBorder]}>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowName}>{r.memberName}</Text>
                    <Text style={styles.rowMeta}>
                      {Math.round(r.rate * 100)}% of {formatNaira(r.activityKobo)} activity · {relativeTime(r.at)}
                    </Text>
                    {r.capped ? <Text style={styles.cappedTag}>Cap applied</Text> : null}
                  </View>
                  <Text style={styles.rowOverride}>+{formatNaira(r.overrideKobo)}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  summaryCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 6 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  summaryValue: { ...Typography.headlineMd, color: Colors.onSurface, fontWeight: '800' as const },
  ratePill: { backgroundColor: Colors.iconBgTeal, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.full },
  rateText: { ...Typography.labelSm, color: Colors.tertiaryContainer, fontWeight: '700' as const },
  summaryBasis: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  capRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.xs },
  capLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  capValue: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '700' as const },
  capTrack: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  capFill: { height: 8, borderRadius: Radius.full, backgroundColor: Colors.gold },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  list: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowBody: { flex: 1, gap: 2 },
  rowName: { ...Typography.labelMd, color: Colors.onSurface },
  rowMeta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  cappedTag: { ...Typography.caption, color: Colors.onWarning, fontWeight: '700' as const },
  rowOverride: { ...Typography.labelLg, color: Colors.tertiaryContainer, fontWeight: '700' as const },
});
