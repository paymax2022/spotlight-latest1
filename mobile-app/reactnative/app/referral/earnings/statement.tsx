import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Download, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import { DisclosureCard } from '@/features/referral/components';
import { formatNaira } from '@/features/referral/constants/format';
import { useStatement, useExportStatement } from '@/features/referral/earnings/hooks';
import type { StatementPeriod } from '@/features/referral/earnings/types';

// M-ERN-07 — Earnings statement / export.
const PERIODS: { value: StatementPeriod; label: string }[] = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'ytd', label: 'Year' },
  { value: 'all', label: 'All time' },
];

export default function StatementScreen() {
  const [period, setPeriod] = useState<StatementPeriod>('30d');
  const { data, isLoading, isError, refetch } = useStatement(period);
  const exportStmt = useExportStatement();
  const [exported, setExported] = useState<string | null>(null);

  const onExport = (format: 'pdf' | 'csv') => {
    setExported(null);
    exportStmt.mutate({ period, format }, { onSuccess: (r) => { if (r.ok) setExported(format.toUpperCase()); } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Earnings statement" />
      <View style={styles.filterWrap}>
        <SegmentedControl<StatementPeriod> value={period} onChange={(p) => { setPeriod(p); setExported(null); }} options={PERIODS} scrollable />
      </View>
      {isLoading ? (
        <StateView kind="loading" message="Loading statement…" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load" message="Try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.summaryCard}>
            <Text style={styles.period}>{new Date(data.fromIso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })} – {new Date(data.toIso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</Text>
            <Line label="Earned" value={formatNaira(data.earnedKobo)} />
            <Line label="Paid out" value={formatNaira(data.paidKobo)} />
            <Line label="Reversed / clawed back" value={formatNaira(data.clawedBackKobo)} negative={data.clawedBackKobo > 0} />
            <View style={styles.divider} />
            <Line label="Entries" value={String(data.rows)} muted />
          </View>

          {exported && (
            <DisclosureCard tone="compliant" body={`${exported} statement ready. We've shared the download link.`} />
          )}

          <View style={styles.exportRow}>
            <Pressable style={styles.exportBtn} onPress={() => onExport('pdf')} disabled={exportStmt.isPending} accessibilityRole="button">
              <FileText size={16} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.exportText}>Export PDF</Text>
            </Pressable>
            <Pressable style={styles.exportBtn} onPress={() => onExport('csv')} disabled={exportStmt.isPending} accessibilityRole="button">
              <Download size={16} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.exportText}>Export CSV</Text>
            </Pressable>
          </View>

          <DisclosureCard tone="info" body="Statements reflect rewards tied to your friends' verified activity. Keep them for your records or tax." />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Line({ label, value, negative, muted }: { label: string; value: string; negative?: boolean; muted?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, muted && styles.muted]}>{label}</Text>
      <Text style={[styles.lineValue, negative && styles.neg, muted && styles.muted]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  filterWrap: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  summaryCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  period: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginBottom: 4 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  lineValue: { ...Typography.labelLg, color: Colors.onSurface },
  neg: { color: Colors.error },
  muted: { color: Colors.onSurfaceVariant },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  exportRow: { flexDirection: 'row', gap: Spacing.sm },
  exportBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingVertical: Spacing.md },
  exportText: { ...Typography.labelMd, color: Colors.primary },
});
