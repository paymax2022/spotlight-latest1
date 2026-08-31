import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, FileCheck2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import { useFinanceSummary } from '@/features/association/hooks/useAdmin';
import { formatNaira, formatNairaCompact } from '@/features/association/utils/associationFormatters';
import type { RevenueLine } from '@/features/association/types/admin.types';

export default function FinanceDashboard() {
  const fin = useFinanceSummary();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Finance & dues" />
      {fin.isLoading ? (
        <StateView kind="loading" message="Loading finance…" />
      ) : fin.isError || !fin.data ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => fin.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Totals */}
          <View style={[styles.totalCard, shadow1]}>
            <Text style={styles.totalLabel}>Collected this year</Text>
            <Text style={styles.totalValue}>{formatNaira(fin.data.collectedKobo)}</Text>
            <View style={styles.divider} />
            <View style={styles.totalRow}>
              <Text style={styles.totalSub}>Outstanding</Text>
              <Text style={[styles.totalSubValue, { color: Colors.error }]}>{formatNaira(fin.data.outstandingKobo)}</Text>
            </View>
          </View>

          {/* Paid / unpaid */}
          <View style={styles.splitRow}>
            <View style={[styles.miniCard, shadow1]}>
              <Text style={[styles.miniValue, { color: Colors.teal }]}>{fin.data.paidMembers.toLocaleString('en-NG')}</Text>
              <Text style={styles.miniLabel}>Paid members</Text>
            </View>
            <View style={[styles.miniCard, shadow1]}>
              <Text style={[styles.miniValue, { color: Colors.error }]}>{fin.data.unpaidMembers.toLocaleString('en-NG')}</Text>
              <Text style={styles.miniLabel}>Unpaid members</Text>
            </View>
          </View>

          {/* Offline approvals entry */}
          <Pressable style={[styles.offlineRow, shadow1]} onPress={() => router.push('/association/admin/finance/offline')} accessibilityRole="button" accessibilityLabel="Offline payment approvals">
            <View style={styles.offlineIcon}><FileCheck2 size={20} color={Colors.primary} strokeWidth={2} /></View>
            <Text style={styles.offlineLabel}>Offline payment approvals</Text>
            {fin.data.offlinePending > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{fin.data.offlinePending}</Text></View> : null}
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>

          {/* Revenue by chapter — the breakdown is optional on the live DTO. */}
          <SectionHeader title="Revenue by chapter" style={styles.sectionGap} />
          <RevenueCard lines={fin.data.byChapter ?? []} />

          {/* Revenue by category */}
          <SectionHeader title="Revenue by category" style={styles.sectionGap} />
          <RevenueCard lines={fin.data.byCategory ?? []} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function maxOf(lines: RevenueLine[]): number {
  return Math.max(1, ...lines.map((l) => l.amountKobo));
}

/** Renders a breakdown, or an empty state when the payload carries none. */
function RevenueCard({ lines }: { lines: RevenueLine[] }) {
  if (lines.length === 0) {
    return (
      <View style={[styles.card, shadow1]}>
        <Text style={styles.emptyText}>No breakdown available yet.</Text>
      </View>
    );
  }
  const max = maxOf(lines);
  return (
    <View style={[styles.card, shadow1]}>
      {lines.map((l, i) => <RevRow key={l.label} line={l} max={max} divider={i > 0} />)}
    </View>
  );
}

function RevRow({ line, max, divider }: { line: RevenueLine; max: number; divider: boolean }) {
  const pct = Math.round((line.amountKobo / max) * 100);
  return (
    <View style={[styles.revRow, divider && styles.revDivider]}>
      <View style={styles.revHead}>
        <Text style={styles.revLabel}>{line.label}</Text>
        <Text style={styles.revValue}>{formatNairaCompact(line.amountKobo)}</Text>
      </View>
      <View style={styles.barTrack}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: 120, gap: Spacing.md },
  totalCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.lg },
  totalLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  // letterSpacing re-stated: displayLg's -0.96 is -0.02em at its own 48px, and
  // spreading the style while overriding only the size keeps that ABSOLUTE
  // value, which is tighter than the scale intends at 34px. -0.68 is the same -0.02em.
  totalValue: { ...Typography.displayLg, fontSize: 34, lineHeight: 40, letterSpacing: -0.68, color: Colors.onSurface },
  divider: { height: 1, backgroundColor: Colors.outlineVariant, marginVertical: Spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalSub: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  totalSubValue: { ...Typography.labelMd },
  splitRow: { flexDirection: 'row', gap: Spacing.sm },
  miniCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 2 },
  miniValue: { ...Typography.headlineMd },
  miniLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  offlineIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  offlineLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  badge: { minWidth: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' as const },
  sectionGap: { paddingHorizontal: 0, marginTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  emptyText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, paddingVertical: Spacing.sm },
  revRow: { paddingVertical: Spacing.sm, gap: 6 },
  revDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  revHead: { flexDirection: 'row', justifyContent: 'space-between' },
  revLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  revValue: { ...Typography.labelMd, color: Colors.onSurface },
  barTrack: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.primary },
});
