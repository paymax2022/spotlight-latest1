import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, FileClock, XCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';
import type { CampaignStatus } from '@/features/crowdfunding/types/crowdfunding.types';

// How often to re-check the campaign's real status while it's still under
// review. Stops on its own the moment the fetched status leaves
// PENDING_REVIEW — see the `polling` flag below — so this never spins forever.
const REVIEW_POLL_MS = 15_000;

export default function CreateSuccessScreen() {
  const { status: initialStatus, id } = useLocalSearchParams<{ status?: string; id?: string }>();

  // The URL param is what we knew at submit time; `liveStatus` is the real,
  // current status once we've fetched it. Admin can approve/reject while the
  // creator is still sitting on this screen, so it has to be able to change
  // out from under the initial param rather than being fixed at mount.
  const [liveStatus, setLiveStatus] = useState<CampaignStatus | undefined>(
    initialStatus as CampaignStatus | undefined,
  );

  const polling = Boolean(id) && (liveStatus === 'PENDING_REVIEW' || liveStatus == null);
  const { data: campaign } = useCampaign(id, {
    refetchInterval: polling ? REVIEW_POLL_MS : false,
    // A "waiting on admin" screen is exactly the kind of thing someone
    // backgrounds while they wait — the default react-query behaviour would
    // otherwise pause polling the moment the tab/app loses focus, so an
    // approval that lands while they're elsewhere would only show up once
    // they come back and something else triggers a refetch.
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (campaign?.status) setLiveStatus(campaign.status);
  }, [campaign?.status]);

  const isDraft = liveStatus === 'DRAFT';
  const isApproved = liveStatus === 'ACTIVE';
  const isRejected = liveStatus === 'REJECTED';
  const isPending = !isDraft && !isApproved && !isRejected;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={[styles.iconBox, iconBoxStyle(isDraft, isApproved, isRejected)]}>
          {isDraft ? (
            <FileClock size={52} color={Colors.onSurfaceVariant} strokeWidth={2} />
          ) : isRejected ? (
            <XCircle size={52} color={Colors.error} strokeWidth={2} />
          ) : (
            <CircleCheck size={52} color={Colors.tertiaryContainer} strokeWidth={2} />
          )}
        </View>

        <Text style={styles.title}>
          {isDraft
            ? 'Draft saved'
            : isApproved
            ? 'Approved — you’re live! 🎉'
            : isRejected
            ? 'Changes needed'
            : 'Submitted for review! 🎉'}
        </Text>

        <Text style={styles.sub}>
          {isDraft
            ? 'Your campaign is saved as a draft. You can finish and submit it anytime from My campaigns.'
            : isApproved
            ? 'Your campaign has been approved and is now live. People can view it and start contributing right away.'
            : isRejected
            ? 'The admin team requested changes before this can go live. Check My campaigns for details.'
            : 'Our team will review your campaign — usually within 24–48 hours. We may request changes or more documents. This page updates automatically once a decision is made.'}
        </Text>

        {isPending && (
          <View style={styles.steps}>
            <Step n={1} label="Admin review & verification" />
            <Step n={2} label="Approval or change request" />
            <Step n={3} label="Campaign goes live" />
          </View>
        )}
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {isApproved && id && (
          <PrimaryButton label="View my campaign" onPress={() => router.dismissTo(`/crowdfunding/campaign/${id}`)} />
        )}
        <PrimaryButton
          label="Go to My campaigns"
          variant={isApproved ? 'ghost' : 'primary'}
          onPress={() => router.dismissTo('/crowdfunding/creator/campaigns')}
        />
        <PrimaryButton label="Back to dashboard" variant="ghost" onPress={() => router.dismissTo('/crowdfunding/creator')} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function iconBoxStyle(isDraft: boolean, isApproved: boolean, isRejected: boolean) {
  if (isDraft) return styles.iconBoxDraft;
  if (isRejected) return styles.iconBoxRejected;
  return styles.iconBoxOk;
}

function Step({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <Text style={styles.stepLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  iconBox: { width: 104, height: 104, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  iconBoxOk: { backgroundColor: Colors.iconBgTeal },
  iconBoxDraft: { backgroundColor: Colors.surfaceContainerHigh },
  iconBoxRejected: { backgroundColor: Colors.iconBgRed },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  steps: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.md },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  stepNum: { width: 28, height: 28, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { ...Typography.labelMd, color: Colors.onPrimary },
  stepLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.xs, paddingBottom: Spacing.md },
});
