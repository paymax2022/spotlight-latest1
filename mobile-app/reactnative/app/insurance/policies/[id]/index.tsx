// ── Protection — one policy ──────────────────────────────────────────────────
// The single source of truth for a policy the user holds: its insurer, its real
// reference numbers, what it cost, what it covers, when it runs out, and the two
// things a person actually comes here to do — get the certificate, and make a
// claim.

import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ChevronRight,
  Download,
  LifeBuoy,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { alertAsync, confirmAsync } from '@/lib/confirm';
import {
  DetailSkeleton,
  InsuranceErrorState,
  StatusPill,
  UnderwriterRow,
  expiryNote,
} from '@/features/insurance/components/live';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';
import {
  useCancelPolicy,
  useCertificateUrl,
  useLivePolicy,
} from '@/features/insurance/live/hooks';
import { nairaFromKobo } from '@/features/insurance/live/money';

export default function PolicyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const policy = useLivePolicy(id ?? '');
  const cancel = useCancelPolicy(id ?? '');

  // Only asked for once we know the policy says a certificate exists — a 404 on
  // a certificate that was never issued is noise, not information.
  const certificate = useCertificateUrl(id ?? '', !!policy.data && policy.data.status !== 'pending');

  if (policy.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Policy" />
        <DetailSkeleton />
      </SafeAreaView>
    );
  }

  if (policy.isError || !policy.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Policy" />
        <InsuranceErrorState error={policy.error} onRetry={() => policy.refetch()} />
      </SafeAreaView>
    );
  }

  const p = policy.data;
  const note = expiryNote(p.endsAt);
  const certificateUrl = p.certificateUrl ?? certificate.data ?? null;

  const open = async (url: string, what: string) => {
    const ok = await Linking.canOpenURL(url);
    if (!ok) {
      await alertAsync({
        title: `Couldn't open your ${what}`,
        message: 'Try again in a moment, or contact support if it keeps happening.',
      });
      return;
    }
    Linking.openURL(url);
  };

  const confirmCancel = async () => {
    const ok = await confirmAsync({
      title: 'Cancel this policy?',
      message:
        'Your cover ends and you may not get the full premium back. This cannot be undone from the app.',
      confirmLabel: 'Cancel policy',
      cancelLabel: 'Keep my cover',
      destructive: true,
    });
    if (!ok) return;
    try {
      await cancel.mutateAsync('Cancelled by the policyholder in the Paymax app');
    } catch {
      await alertAsync({
        title: "We couldn't cancel it",
        message: 'Your policy is unchanged. Please try again, or contact support.',
      });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your policy" subtitle={p.productName} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Headline */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <ShieldCheck size={24} color={Colors.onPrimary} strokeWidth={2.2} />
          </View>
          <Text style={styles.heroTitle}>{p.productName}</Text>
          <View style={styles.heroPills}>
            <StatusPill status={p.status} />
            {note ? <Text style={styles.heroNote}>{note}</Text> : null}
          </View>
          {p.sumInsuredKobo > 0 ? (
            <Text style={styles.heroCover}>
              Covered for {nairaFromKobo(p.sumInsuredKobo, { decimals: false })}
            </Text>
          ) : null}
        </View>

        <UnderwriterRow underwriter={p.underwriter} />

        {/* Facts */}
        <View style={styles.card}>
          <Row label="Policy number" value={p.policyRef || '—'} copyable />
          {p.providerPolicyRef && p.providerPolicyRef !== p.policyRef ? (
            <Row label="Insurer's reference" value={p.providerPolicyRef} copyable />
          ) : null}
          <Row label="Premium" value={nairaFromKobo(p.premiumKobo)} />
          <Row label="Cover starts" value={formatDay(p.startsAt)} />
          <Row label="Cover ends" value={formatDay(p.endsAt)} />
          <Row label="Bought" value={formatDay(p.createdAt)} />
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          {certificateUrl ? (
            <ActionRow
              icon={<Download size={19} color={InsuranceColors.brand} />}
              title="Certificate"
              subtitle="Download or share proof of cover"
              onPress={() => open(certificateUrl, 'certificate')}
            />
          ) : (
            <View style={styles.actionDisabled}>
              <Download size={19} color={Colors.outline} />
              <View style={styles.grow}>
                <Text style={styles.actionTitleDisabled}>Certificate</Text>
                <Text style={styles.actionSubtitle}>
                  {p.status === 'pending'
                    ? 'Appears here once the insurer issues it'
                    : 'The insurer has not issued one for this policy'}
                </Text>
              </View>
            </View>
          )}

          {/* Claims run through the insurer's own hosted flow — there is no API
              to post a claim to — so this hands the user off with the policy
              already identified, rather than pretending to file it here. */}
          {p.claimUrl ? (
            <ActionRow
              icon={<LifeBuoy size={19} color={InsuranceColors.brand} />}
              title="Make a claim"
              subtitle={`Start a claim with ${p.underwriter || 'your insurer'}`}
              onPress={() => open(p.claimUrl as string, 'claim form')}
            />
          ) : null}

          {p.inspectionUrl ? (
            <ActionRow
              icon={<ShieldCheck size={19} color={InsuranceColors.brand} />}
              title="Submit inspection"
              subtitle="Required before some claims can be paid"
              onPress={() => open(p.inspectionUrl as string, 'inspection form')}
            />
          ) : null}

          {p.status === 'active' ? (
            <ActionRow
              icon={<RefreshCw size={19} color={InsuranceColors.brand} />}
              title="Renew"
              subtitle="Buy the next period of this cover"
              onPress={() =>
                router.push(`/insurance/product/${encodeURIComponent(p.productCode)}`)
              }
            />
          ) : null}

          {p.status === 'active' || p.status === 'pending' ? (
            <ActionRow
              icon={<XCircle size={19} color={Colors.error} />}
              title="Cancel this policy"
              subtitle="Ends your cover"
              destructive
              onPress={confirmCancel}
            />
          ) : null}
        </View>

        <Text style={styles.disclaimer}>
          This policy is underwritten by {p.underwriter || 'a NAICOM-licensed insurer'}. Paymax
          distributes it and does not carry the risk. Your full policy wording is issued with your
          certificate.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1} selectable={copyable}>
        {value}
      </Text>
    </View>
  );
}

function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
  destructive,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <View style={styles.actionIcon}>{icon}</View>
      <View style={styles.grow}>
        <Text style={[styles.actionTitle, destructive && styles.actionTitleDanger]}>{title}</Text>
        <Text style={styles.actionSubtitle}>{subtitle}</Text>
      </View>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} />
    </Pressable>
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
  grow: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 48, gap: Spacing.md },

  hero: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  heroIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { ...Typography.titleLg, color: Colors.onPrimary },
  heroPills: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  heroNote: { ...Typography.labelSm, color: Colors.inversePrimary },
  heroCover: { ...Typography.bodySm, color: Colors.inversePrimary },

  card: {
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  rowLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rowValue: { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1, textAlign: 'right' },

  actions: { gap: Spacing.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    padding: Spacing.md,
  },
  actionDisabled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  pressed: { opacity: 0.9 },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: { ...Typography.labelLg, color: Colors.onSurface },
  actionTitleDanger: { color: Colors.error },
  actionTitleDisabled: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  actionSubtitle: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },

  disclaimer: { ...Typography.labelSm, color: Colors.onSurfaceVariant, lineHeight: 18 },
});
