import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, Clock, XCircle, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TierLimitBar from '@/features/connect/components/TierLimitBar';
import type { KycStepState } from '@/features/connect/wallet/types';
import { useKycStatus, useTierStatus } from '@/features/connect/wallet/hooks';

// WL-11 — Tier & KYC status hub: current tier, per-document progress, next step.
export default function TierStatusScreen() {
  const kyc = useKycStatus();
  const tierQ = useTierStatus();

  if (kyc.isLoading || tierQ.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Tier & verification" />
        <StateView kind="loading" message="Loading your tier…" />
      </SafeAreaView>
    );
  }
  if (kyc.error || !kyc.data || !tierQ.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Tier & verification" />
        <StateView kind="error" title="Couldn't load tier" actionLabel="Retry" onAction={() => kyc.refetch()} />
      </SafeAreaView>
    );
  }

  const k = kyc.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Tier & verification" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        {k.reviewState === 'pending' ? (
          <Banner icon={<Clock size={16} color={Colors.gold} />} bg={Colors.iconBgGold}
            text={`Tier ${k.pendingTarget} application under review.`}
            onPress={() => router.push('/connect/wallet/tier/pending')} />
        ) : null}
        {k.reviewState === 'rejected' ? (
          <Banner icon={<XCircle size={16} color={Colors.error} />} bg={Colors.errorContainer}
            text="Your last upgrade was rejected. Tap to review."
            onPress={() => router.push('/connect/wallet/tier/rejected')} />
        ) : null}

        <TierLimitBar tier={tierQ.data} />

        <Text style={styles.sectionTitle}>Verification</Text>
        <View style={styles.card}>
          <DocRow label="BVN" state={k.bvn} />
          <DocRow label="NIN" state={k.nin} />
          <DocRow label="Photo ID" state={k.photoId} />
          <DocRow label="Proof of address" state={k.address} />
          <DocRow label="Liveness" state={k.liveness} />
          <DocRow label="Enhanced due diligence" state={k.edd} last />
        </View>

        <Pressable style={styles.linkRow} onPress={() => router.push('/connect/wallet/tier/limits')}>
          <Text style={styles.linkText}>View all tier limits</Text>
          <ChevronRight size={16} color={Colors.primary} />
        </Pressable>
      </ScrollView>

      {k.tier < 3 && k.reviewState !== 'pending' ? (
        <View style={styles.footer}>
          <PrimaryButton label={`Upgrade to Tier ${k.tier + 1}`} onPress={() => router.push('/connect/wallet/tier/upgrade-intro')} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Banner({ icon, bg, text, onPress }: { icon: React.ReactNode; bg: string; text: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.banner, { backgroundColor: bg }]}>
      {icon}
      <Text style={styles.bannerText}>{text}</Text>
      <ChevronRight size={16} color={Colors.onSurfaceVariant} />
    </Pressable>
  );
}

function DocRow({ label, state, last }: { label: string; state: KycStepState; last?: boolean }) {
  return (
    <View style={[styles.docRow, !last && styles.docRowBorder]}>
      <Text style={styles.docLabel}>{label}</Text>
      <DocBadge state={state} />
    </View>
  );
}

function DocBadge({ state }: { state: KycStepState }) {
  if (state === 'passed') return <View style={styles.badgeOk}><Check size={12} color={Colors.teal} /><Text style={styles.badgeOkText}>Verified</Text></View>;
  if (state === 'pending') return <Text style={[styles.badgeText, { color: Colors.gold }]}>Pending</Text>;
  if (state === 'rejected') return <Text style={[styles.badgeText, { color: Colors.error }]}>Rejected</Text>;
  return <Text style={[styles.badgeText, { color: Colors.onSurfaceVariant }]}>Not started</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40, gap: Spacing.md },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  bannerText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  docRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  docRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerLow },
  docLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  badgeText: { ...Typography.labelSm },
  badgeOk: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeOkText: { ...Typography.labelSm, color: Colors.teal },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: Spacing.sm },
  linkText: { ...Typography.labelMd, color: Colors.primary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
