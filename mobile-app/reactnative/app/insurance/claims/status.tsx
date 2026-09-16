// ── Protection — claim status ────────────────────────────────────────────────
// One claim, as the insurer reports it. Everything here comes from GET
// /claims/:id — progress is driven by the insurer's own assessment and reaches
// us over webhooks, so this screen reads rather than acts.

import React from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { FileText, Paperclip } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import {
  DetailSkeleton,
  InsuranceErrorState,
  StatusPill,
  claimStatusLabel,
} from '@/features/insurance/components/live';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import { useLiveClaim } from '@/features/insurance/live/hooks';
import { nairaFromKobo } from '@/features/insurance/live/money';
import type { ClaimStatus } from '@/features/insurance/live/types';

/** The insurer's assessment, in the order it happens. */
const STAGES: ClaimStatus[] = ['submitted', 'under_review', 'approved', 'paid'];

export default function ClaimStatusScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const claim = useLiveClaim(id ?? '');

  if (claim.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Claim" />
        <DetailSkeleton />
      </SafeAreaView>
    );
  }

  if (claim.isError || !claim.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Claim" />
        <InsuranceErrorState error={claim.error} onRetry={() => claim.refetch()} />
      </SafeAreaView>
    );
  }

  const c = claim.data;
  const rejected = c.status === 'rejected';
  const currentIndex = STAGES.indexOf(c.status);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your claim" subtitle={c.claimRef || undefined} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={claim.isFetching}
            onRefresh={() => claim.refetch()}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.statusCard}>
          <StatusPill status={c.status} kind="claim" />
          <Text style={styles.statusHeadline}>
            {rejected
              ? 'Your insurer has declined this claim'
              : c.status === 'paid'
                ? 'Your claim has been paid'
                : c.status === 'approved'
                  ? 'Approved — payment is being arranged'
                  : c.status === 'under_review'
                    ? 'Your insurer is assessing this claim'
                    : 'Your claim is with the insurer'}
          </Text>
          {c.approvedAmountKobo != null ? (
            <Text style={styles.statusAmount}>{nairaFromKobo(c.approvedAmountKobo)} approved</Text>
          ) : c.claimedAmountKobo > 0 ? (
            <Text style={styles.statusAmount}>{nairaFromKobo(c.claimedAmountKobo)} claimed</Text>
          ) : null}
        </View>

        {/* A declined claim does not belong on a progress track — showing it
            part-way along a path to "Paid" would be misleading. */}
        {!rejected ? (
          <View style={styles.timeline}>
            {STAGES.map((stage, i) => {
              const done = currentIndex >= i;
              const isCurrent = currentIndex === i;
              return (
                <View key={stage} style={styles.stage}>
                  <View style={styles.stageRail}>
                    <View style={[styles.stageDot, done && styles.stageDotDone]} />
                    {i < STAGES.length - 1 ? (
                      <View style={[styles.stageLine, currentIndex > i && styles.stageLineDone]} />
                    ) : null}
                  </View>
                  <View style={styles.stageBody}>
                    <Text style={[styles.stageLabel, done && styles.stageLabelDone]}>
                      {claimStatusLabel(stage)}
                    </Text>
                    {isCurrent ? <Text style={styles.stageNote}>Where your claim is now</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Details</Text>
          <Row label="Reference" value={c.claimRef || '—'} />
          {c.providerClaimRef && c.providerClaimRef !== c.claimRef ? (
            <Row label="Insurer's reference" value={c.providerClaimRef} />
          ) : null}
          <Row label="What happened" value={c.description || '—'} />
          <Row label="Date of loss" value={formatDay(c.lossEventAt)} />
          <Row label="Filed" value={formatDay(c.createdAt)} />
        </View>

        {c.evidence.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Evidence you sent</Text>
            {c.evidence.map((e) => (
              <Text
                key={e.id}
                style={styles.evidence}
                numberOfLines={1}
                onPress={() => (e.url ? Linking.openURL(e.url) : undefined)}
              >
                <Paperclip size={13} color={InsuranceColors.muted} /> {e.name}
              </Text>
            ))}
          </View>
        ) : null}

        <Text style={styles.footnote}>
          Your insurer decides this claim. We show their status as they report it — pull down to
          refresh.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelWrap}>
        <FileText size={13} color={Colors.onSurfaceVariant} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function formatDay(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 48, gap: Spacing.md },

  statusCard: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  statusHeadline: { ...Typography.titleMd, color: Colors.onSurface },
  statusAmount: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },

  timeline: { paddingLeft: Spacing.xs },
  stage: { flexDirection: 'row', gap: Spacing.md },
  stageRail: { alignItems: 'center', width: 18 },
  stageDot: {
    width: 12,
    height: 12,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerHigh,
    marginTop: 4,
  },
  stageDotDone: { backgroundColor: InsuranceColors.ok },
  stageLine: { flex: 1, width: 2, backgroundColor: Colors.surfaceContainerHigh, minHeight: 26 },
  stageLineDone: { backgroundColor: InsuranceColors.ok },
  stageBody: { flex: 1, paddingBottom: Spacing.md },
  stageLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  stageLabelDone: { color: Colors.onSurface, fontWeight: '600' as const },
  stageNote: { ...Typography.labelSm, color: InsuranceColors.brand, marginTop: 2 },

  card: {
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: 5,
  },
  rowLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  rowLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, flex: 1, textAlign: 'right' },
  evidence: { ...Typography.labelMd, color: InsuranceColors.brand, paddingVertical: 4 },
  footnote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
});
