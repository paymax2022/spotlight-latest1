// ── Paymax · Admin Console — Reconciliation ──────────────────────────────────
// Renders the recon Report: a summary (balanced vs open exceptions) plus a
// ListCard of per-asset exceptions (expected/internal vs actual/external + the
// delta) using DataRow. When there are no exceptions, a success "all balanced"
// state is shown instead.

import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { AdminHeader, ListCard, DataRow, KpiCard, StatusPill } from '@/features/admin/components';
import { useReconciliation } from '@/features/admin/hooks/useAdmin';
import { formatMoneyObj, formatDateTime } from '@/features/admin/constants/admin.constants';
import type { ReconException } from '@/features/admin/types/admin.types';

function exceptionKindLabel(kind: string): string {
  return kind.replace(/_/g, ' ');
}

export default function AdminReconciliationScreen() {
  const recon = useReconciliation();

  const report = recon.data;
  const exceptions: ReconException[] = report?.exceptions ?? [];
  const balanced = exceptions.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AdminHeader title="Reconciliation" subtitle="Ledger exceptions" />

      {recon.isLoading ? (
        <StateView kind="loading" message="Reconciling ledgers…" />
      ) : recon.isError ? (
        <StateView
          kind="error"
          title="Couldn't load reconciliation"
          message={(recon.error as Error)?.message ?? 'Please check your connection and try again.'}
          actionLabel="Retry"
          onAction={() => recon.refetch()}
        />
      ) : !report ? (
        <StateView kind="empty" icon="Scale" title="No report" message="No reconciliation report is available yet." />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={recon.isRefetching} onRefresh={() => recon.refetch()} tintColor={Colors.primary} />
          }
        >
          {/* Summary */}
          <View style={styles.kpiRow}>
            <KpiCard
              label="Status"
              value={balanced ? 'Balanced' : 'Exceptions'}
              icon={balanced ? 'CheckCircle2' : 'AlertTriangle'}
              intent={balanced ? 'positive' : 'negative'}
              iconBg={balanced ? Colors.iconBgTeal : Colors.iconBgRed}
              iconColor={balanced ? Colors.teal : Colors.error}
            />
            <KpiCard
              label="Open exceptions"
              value={String(exceptions.length)}
              icon="ListChecks"
              iconBg={Colors.iconBgPurple}
              iconColor={Colors.primary}
            />
          </View>

          {report.generatedAt ? (
            <Text style={styles.generatedAt}>Generated {formatDateTime(report.generatedAt)}</Text>
          ) : null}

          {balanced ? (
            <View style={styles.successCard}>
              <Text style={styles.successTitle}>All ledgers balanced</Text>
              <Text style={styles.successText}>
                Internal balances reconcile with external custody/provider records. No exceptions to investigate.
              </Text>
            </View>
          ) : (
            exceptions.map((ex) => (
              <ListCard key={ex.id} flush style={styles.exceptionCard}>
                <View style={styles.exceptionHead}>
                  <Text style={styles.exceptionAsset}>{ex.asset}</Text>
                  <StatusPill chip={{ label: exceptionKindLabel(ex.kind), fg: Colors.error, bg: Colors.iconBgRed }} />
                </View>
                <DataRow label="Internal (expected)" value={formatMoneyObj(ex.internal)} />
                <DataRow label="External (actual)" value={formatMoneyObj(ex.external)} />
                <DataRow
                  label="Delta"
                  right={
                    <Text style={styles.delta}>{formatMoneyObj(ex.delta)}</Text>
                  }
                />
                <DataRow label="Detected" value={formatDateTime(ex.detectedAt)} last />
              </ListCard>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl, paddingTop: Spacing.sm, gap: Spacing.md },
  kpiRow: { flexDirection: 'row', gap: Spacing.md, marginHorizontal: Spacing.containerMargin },
  generatedAt: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
    marginHorizontal: Spacing.containerMargin,
    marginTop: -Spacing.xs,
  },
  successCard: {
    marginHorizontal: Spacing.containerMargin,
    padding: Spacing.cardPadding,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.lg,
    gap: Spacing.xs,
  },
  successTitle: { ...Typography.titleMd, color: Colors.tertiaryContainer },
  successText: { ...Typography.bodySm, color: Colors.onSurface },
  exceptionCard: { marginBottom: 0 },
  exceptionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.cardPadding,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    gap: Spacing.sm,
  },
  exceptionAsset: { ...Typography.titleMd, color: Colors.onSurface },
  delta: { ...Typography.labelMd, color: Colors.error },
});
