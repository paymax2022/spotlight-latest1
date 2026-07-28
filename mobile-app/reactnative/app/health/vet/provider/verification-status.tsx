// ── Paymax Health — Vet Mode B (assisted) VCN verification status ───────────
// PRIVACY-CRITICAL (HL-2 / HL-8): this member-facing screen shows ONLY the coarse
// verification stage. It MUST NEVER render the VCN registration number, matched
// fields, register data, the reviewer's identity, or any review notes. The status
// API deliberately returns only { applicationId, capability, stage } — nothing
// here reaches into register/match detail, and nothing should ever be added.

import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, Clock, BadgeCheck, RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useVcnStatus } from '@/features/health/vet/hooks';
import type { VcnStage } from '@/features/health/vet/types';

type StageMeta = {
  title: string;
  body: string;
  Icon: typeof Clock;
  iconColor: string;
  iconBg: string;
};

// Coarse stage presentation only — no register data, ever.
const STAGE_META: Record<VcnStage, StageMeta> = {
  pending_review: {
    title: 'Pending review',
    body: "We're reviewing your credentials. This usually takes 1–2 business days.",
    Icon: Clock,
    iconColor: Colors.onWarning,
    iconBg: Colors.iconBgGold,
  },
  more_info_needed: {
    title: 'More information needed',
    body: 'We need a bit more from you — please re-submit your documents.',
    Icon: RefreshCw,
    iconColor: Colors.onWarning,
    iconBg: Colors.iconBgGold,
  },
  verified: {
    title: 'Verified',
    body: "Your veterinary credentials are verified. You're now discoverable to pet owners.",
    Icon: BadgeCheck,
    iconColor: Colors.teal,
    iconBg: Colors.iconBgTeal,
  },
  not_verified: {
    title: 'Not verified',
    body: 'Your veterinary credentials could not be verified at this time.',
    Icon: ShieldCheck,
    iconColor: Colors.onSurfaceVariant,
    iconBg: Colors.surfaceContainerHigh,
  },
};

export default function VetVcnVerificationStatusScreen() {
  const params = useLocalSearchParams<{ applicationId?: string }>();
  const applicationId = params.applicationId;
  const { data: status, isLoading, isError, refetch } = useVcnStatus(applicationId);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Verification status" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (isError || !status) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Verification status" />
        <StateView kind="error" title="Couldn't load status" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  const meta = STAGE_META[status.stage];
  const { Icon } = meta;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Verification status" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.statusCard, shadow1]}>
          <View style={[styles.statusIcon, { backgroundColor: meta.iconBg }]}>
            <Icon size={28} color={meta.iconColor} strokeWidth={2} />
          </View>
          <Text style={styles.statusTitle}>{meta.title}</Text>
          <Text style={styles.statusSub}>{meta.body}</Text>
        </View>

        {status.stage === 'more_info_needed' ? (
          <PrimaryButton
            label="Re-submit documents"
            onPress={() => router.replace('/health/vet/provider/verification')}
          />
        ) : null}
        {status.stage === 'verified' ? (
          <PrimaryButton
            label="Go to dashboard"
            onPress={() => router.replace('/health/vet/provider/requests')}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  statusCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    alignItems: 'center',
  },
  statusIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { ...Typography.headlineMd, fontSize: 20, color: Colors.onSurface },
  statusSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', lineHeight: 19 },
});
