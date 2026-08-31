// ── Protection — you're covered ──────────────────────────────────────────────
// This screen is reached with a POLICY ID, and it fetches that policy before it
// congratulates anybody.
//
// That is deliberate. A purchase has two legs — the payment and the insurer's
// bind — and they can disagree: the payment can look fine while the insurer
// refuses to issue. Celebrating off the payment leg alone is how a person ends
// up believing they are insured when they are not, which is the worst outcome
// this module can produce. So the confirmed policy is the only thing that earns
// this screen; anything else lands on the failure screen instead.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarDays, FileText, ShieldCheck } from 'lucide-react-native';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import {
  InsuranceErrorState,
  StatusPill,
  UnderwriterRow,
  SkeletonBlock,
} from '@/features/insurance/components/live';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import { useLivePolicy } from '@/features/insurance/live/hooks';
import { nairaFromKobo } from '@/features/insurance/live/money';

export default function PurchaseSuccess() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const policy = useLivePolicy(id ?? '');

  if (policy.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.loadingWrap}>
          <SkeletonBlock width={72} height={72} radius={9999} />
          <SkeletonBlock width="70%" height={22} />
          <SkeletonBlock width="90%" height={14} />
          <SkeletonBlock width="100%" height={140} radius={Radius.xl} />
        </View>
      </SafeAreaView>
    );
  }

  // We got here with a policy id but cannot read the policy back. Rather than
  // assert cover we have not confirmed, say exactly that and send them to the
  // wallet where the truth will be.
  if (policy.isError || !policy.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <InsuranceErrorState
          error={policy.error}
          onRetry={() => policy.refetch()}
        />
        <View style={styles.footer}>
          <PrimaryButton
            label="Go to my policies"
            onPress={() => router.replace('/insurance/policies')}
          />
        </View>
      </SafeAreaView>
    );
  }

  const p = policy.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.iconWrap}>
          <ShieldCheck size={36} color={Colors.onPrimary} strokeWidth={2} />
        </View>

        <Text style={styles.title}>You're covered</Text>
        <Text style={styles.body}>
          {p.underwriter || 'Your insurer'} has issued your policy. It's in your policy wallet, and
          we'll remind you before it needs renewing.
        </Text>

        <View style={styles.card}>
          <Text style={styles.productName}>{p.productName}</Text>
          <View style={styles.pillRow}>
            <StatusPill status={p.status} />
          </View>

          <View style={styles.divider} />

          <Row label="Policy number" value={p.policyRef || '—'} />
          <Row label="Premium paid" value={nairaFromKobo(p.premiumKobo)} />
          {p.sumInsuredKobo > 0 ? (
            <Row label="You're covered for" value={nairaFromKobo(p.sumInsuredKobo, { decimals: false })} />
          ) : null}
          {p.startsAt || p.endsAt ? (
            <Row
              label="Cover runs"
              value={`${formatDay(p.startsAt)} – ${formatDay(p.endsAt)}`}
              icon={<CalendarDays size={14} color={Colors.onSurfaceVariant} />}
            />
          ) : null}
        </View>

        <UnderwriterRow underwriter={p.underwriter} />

        {/* Pending is a real, honest state: the insurer has taken the policy on
            but not finished issuing it. Say so rather than implying immediate
            cover the person does not yet have. */}
        {p.status === 'pending' ? (
          <View style={styles.pendingNote}>
            <Text style={styles.pendingText}>
              Your insurer is still finalising this policy. Your certificate appears here as soon as
              they issue it — usually within a few minutes.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label="View my policy"
          onPress={() => router.replace(`/insurance/policies/${encodeURIComponent(p.id)}`)}
        />
        <PrimaryButton
          label="Back to Protection"
          variant="ghost"
          onPress={() => router.replace('/insurance')}
        />
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabel}>
        {icon ?? <FileText size={14} color={Colors.onSurfaceVariant} />}
        <Text style={styles.rowLabelText}>{label}</Text>
      </View>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
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
  safe: { flex: 1, backgroundColor: Colors.background },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.containerMargin,
    gap: Spacing.md,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.containerMargin,
    paddingVertical: Spacing.lg,
    gap: Spacing.md,
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  body: {
    ...Typography.bodyMd,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 24,
  },
  card: {
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  productName: { ...Typography.titleMd, color: Colors.onSurface },
  pillRow: { flexDirection: 'row' },
  divider: { height: 1, backgroundColor: InsuranceColors.border, marginVertical: Spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: 5,
  },
  rowLabel: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  rowLabelText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },
  pendingNote: {
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  pendingText: { ...Typography.bodySm, color: Colors.onSurface, lineHeight: 20 },
  footer: { padding: Spacing.containerMargin, gap: Spacing.sm },
});
