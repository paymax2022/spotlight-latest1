import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { ShieldCheck, ShieldAlert, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { ReferralHeader, StateBadge } from '@/features/referral/components';
import { useStanding } from '@/features/referral/foundation/hooks';
import { formatNaira } from '@/features/referral/constants/format';
import type { StandingLevel, FraudFlag } from '@/features/referral/foundation/types';

// M-ACC-01 — Verification & fraud status. Standing, flags, what to fix.
const LEVEL_META: Record<StandingLevel, { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral'; blurb: string }> = {
  good:       { label: 'Good standing',  tone: 'ok',     blurb: 'Your account is in good standing. Keep referrals genuine to stay here.' },
  review:     { label: 'Under review',   tone: 'warn',   blurb: 'Some activity is being reviewed. Rewards may be held until it clears.' },
  restricted: { label: 'Restricted',     tone: 'warn',   blurb: 'Earning is limited until you resolve the flags below.' },
  suspended:  { label: 'Suspended',      tone: 'danger', blurb: 'Earning is suspended. Contact support to understand next steps.' },
};
const SEVERITY_TONE: Record<FraudFlag['severity'], 'neutral' | 'warn' | 'danger'> = { info: 'neutral', warn: 'warn', danger: 'danger' };

export default function VerificationFraudStatus() {
  const { data, isLoading, isError, refetch } = useStanding();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ReferralHeader title="Verification & status" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load your status" actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Standing summary */}
          <View style={styles.summary}>
            <View style={[styles.summaryIcon, data.level === 'good' ? styles.iconOk : styles.iconWarn]}>
              {data.level === 'good'
                ? <ShieldCheck size={26} color={Colors.tertiaryContainer} strokeWidth={2} />
                : <ShieldAlert size={26} color={Colors.error} strokeWidth={2} />}
            </View>
            <StateBadge label={LEVEL_META[data.level].label} tone={LEVEL_META[data.level].tone} />
            <Text style={styles.summaryBlurb}>{LEVEL_META[data.level].blurb}</Text>
          </View>

          {/* KYC + earnings stats */}
          <View style={styles.statsRow}>
            <Stat label="KYC tier" value={`Tier ${data.kycTier}`} />
            <Stat label="Earned" value={formatNaira(data.earnedKobo)} />
            <Stat label="Withheld" value={formatNaira(data.withheldKobo)} />
          </View>

          {/* Flags / what to fix */}
          <Text style={styles.sectionTitle}>What to fix</Text>
          {data.flags.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>No flags. Nothing to fix.</Text></View>
          ) : (
            data.flags.map((f) => {
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[f.severity === 'danger' ? 'CircleAlert' : f.severity === 'warn' ? 'TriangleAlert' : 'Info'] ?? Icons.Info;
              return (
                <View key={f.id} style={styles.flag}>
                  <Icon size={18} color={f.severity === 'danger' ? Colors.error : f.severity === 'warn' ? Colors.onWarning : Colors.secondary} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.flagLabel}>{f.label}</Text>
                    <Text style={styles.flagDetail}>{f.detail}</Text>
                  </View>
                  <StateBadge label={f.severity} tone={SEVERITY_TONE[f.severity]} />
                </View>
              );
            })
          )}

          {data.flags.some((f) => f.fix?.toLowerCase().includes('kyc')) && (
            <Pressable style={styles.cta} onPress={() => router.push('/kyc')} accessibilityRole="button">
              <Text style={styles.ctaText}>Complete KYC</Text>
              <ChevronRight size={18} color={Colors.primary} strokeWidth={2} />
            </Pressable>
          )}

          <Pressable style={styles.report} onPress={() => router.push('/referral/account/report-abuse')} accessibilityRole="button">
            <Text style={styles.reportText}>See something suspicious? Report it.</Text>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.md },
  summary: { alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.lg },
  summaryIcon: { width: 56, height: 56, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center' },
  iconOk: { backgroundColor: Colors.iconBgTeal },
  iconWarn: { backgroundColor: Colors.errorContainer },
  summaryBlurb: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  stat: { flex: 1, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, alignItems: 'center', gap: 2 },
  statValue: { ...Typography.titleMd, color: Colors.onSurface },
  statLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  empty: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md },
  emptyText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  flag: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  flagLabel: { ...Typography.labelLg, color: Colors.onSurface },
  flagDetail: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  ctaText: { ...Typography.labelLg, color: Colors.primary },
  report: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  reportText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
});
