import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, ArrowUpRight, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { formatKobo } from '@/features/connect/constants/format';
import type { TierLimitsRow, ConnectTier } from '@/features/connect/wallet/types';
import { useKycStatus, useTierLimits } from '@/features/connect/wallet/hooks';

// WL-12 — Upgrade intro: shows the delta (limits + privileges) of the next tier
// and routes to the correct KYC step.
const STEP_ROUTE: Record<number, string> = {
  1: '/connect/wallet/tier/tier1-bvn-nin',
  2: '/connect/wallet/tier/tier2-id-address',
  3: '/connect/wallet/tier/tier3-liveness-edd',
};

export default function UpgradeIntro() {
  const kyc = useKycStatus();
  const limits = useTierLimits();

  if (kyc.isLoading || limits.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Upgrade tier" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (kyc.error || !kyc.data || !limits.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Upgrade tier" />
        <StateView kind="error" title="Couldn't load tiers" actionLabel="Retry" onAction={() => kyc.refetch()} />
      </SafeAreaView>
    );
  }

  const current = kyc.data.tier;
  if (current >= 3) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Upgrade tier" />
        <StateView kind="empty" icon="ShieldCheck" title="You're at the top tier"
          message="Tier 3 unlocks the highest gifting and withdrawal ceilings." />
      </SafeAreaView>
    );
  }

  const nextTier = (current + 1) as ConnectTier;
  const cur = limits.data.find((r) => r.tier === current);
  const next = limits.data.find((r) => r.tier === nextTier) as TierLimitsRow;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Upgrade to ${next.label}`} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}><ShieldCheck size={24} color={Colors.primary} /></View>
          <Text style={styles.heroTitle}>{next.label}</Text>
          <Text style={styles.heroReq}>{next.requirement}</Text>
        </View>

        <Text style={styles.sectionTitle}>What changes</Text>
        <View style={styles.card}>
          <Delta label="Daily limit"
            from={cur ? fmtLimit(cur.dailyLimitKobo) : '—'} to={fmtLimit(next.dailyLimitKobo)} />
          <Delta label="Max single gift"
            from={cur ? fmtLimit(cur.singleGiftMaxKobo) : '—'} to={fmtLimit(next.singleGiftMaxKobo)} />
          <Delta label="Daily withdrawal"
            from={cur ? fmtWithdraw(cur.withdrawDailyKobo) : '—'} to={fmtWithdraw(next.withdrawDailyKobo)} last />
        </View>

        <Text style={styles.sectionTitle}>You'll unlock</Text>
        <View style={styles.card}>
          {next.privileges.map((p, i) => (
            <View key={i} style={styles.privRow}>
              <Check size={16} color={Colors.teal} strokeWidth={2.4} />
              <Text style={styles.privText}>{p}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Start verification" onPress={() => router.push(STEP_ROUTE[nextTier] as never)} />
      </View>
    </SafeAreaView>
  );
}

function fmtLimit(k: number | null) { return k == null ? 'No limit' : k === 0 ? '—' : formatKobo(k); }
function fmtWithdraw(k: number | null) { return k == null ? 'No limit' : !k ? 'Not available' : `${formatKobo(k)}/day`; }

function Delta({ label, from, to, last }: { label: string; from: string; to: string; last?: boolean }) {
  return (
    <View style={[styles.deltaRow, !last && styles.deltaBorder]}>
      <Text style={styles.deltaLabel}>{label}</Text>
      <View style={styles.deltaValues}>
        <Text style={styles.deltaFrom}>{from}</Text>
        <ArrowUpRight size={14} color={Colors.teal} />
        <Text style={styles.deltaTo}>{to}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40, gap: Spacing.md },
  heroCard: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg },
  heroIcon: { width: 56, height: 56, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.sm },
  heroReq: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  deltaRow: { paddingVertical: Spacing.md },
  deltaBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerLow },
  deltaLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  deltaValues: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 2 },
  deltaFrom: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  deltaTo: { ...Typography.titleMd, color: Colors.onSurface },
  privRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  privText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
