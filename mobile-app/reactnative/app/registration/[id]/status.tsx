// The applicant's own view of their entry.
//
// It used to answer one question — where is the review? — and stop. For an Open
// Mic artist the review is only the first half: approval is the *start* of the
// work (download the beat, record, hand in the song), and the page that tells
// them they are approved while hiding all of that sent them hunting through the
// app for a screen that already existed. So this page now carries the phase
// itself, the banner that names the edition, the picture they uploaded, and a
// history list that includes the milestones they actually completed.
//
// Everything here is read, never decided: the beat/song cards ask the eligibility
// endpoint, the vote button asks the voting endpoint (which refuses while no song
// is on record), and the extra history steps ask the workflow endpoint. Each is a
// separate route because the legacy `/status` route is brownfield-protected.
import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import StatusChip from '@/features/registration/components/StatusChip';
import {
  useStatus,
  useWithdraw,
  useRegistrationVoting,
  useApplicationWorkflow,
} from '@/features/registration/hooks/useRegistration';
import ContestVotingCard from '@/features/registration/components/ContestVotingCard';
import ProfilePhotoAvatar from '@/features/registration/components/ProfilePhotoAvatar';
import { mergeStatusTimeline } from '@/features/registration/utils/timeline';
import OpenMicPhasePanel from '@/features/openmic/components/OpenMicPhasePanel';
import OpenMicBanner from '@/features/openmic/components/OpenMicBanner';
import { isOpenMicApplication } from '@/features/openmic/edition';
import { formatStamp } from '@/features/openmic/state';
import { useOpenMicPhase } from '@/features/openmic/hooks';
import { confirmAsync, alertAsync } from '@/lib/confirm';

const TERMINAL = ['withdrawn', 'rejected', 'disqualified', 'eliminated', 'winner'];

export default function RegistrationStatusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const appId = id ?? '';

  const statusQuery = useStatus(appId);
  const withdraw = useWithdraw(appId);
  // Voting context is loaded separately from a NEW endpoint: the status route
  // is brownfield-protected, so it could not grow these fields.
  const votingQuery = useRegistrationVoting(appId);
  const { workflow, refresh: refreshWorkflow } = useApplicationWorkflow(appId);

  const draft = statusQuery.data?.draft;
  const timeline = statusQuery.data?.timeline ?? [];

  // Decided from the type, the category and the slug — a slug list alone hides a
  // real edition, which is exactly how the beat went missing from this page.
  const isOpenMic = isOpenMicApplication({
    contestSlug: draft?.contestSlug,
    formData: draft?.formData,
  });
  const contestSlug = String(draft?.contestSlug ?? '').trim();
  // An empty slug leaves the query disabled, so a non-Open-Mic application costs
  // this page nothing.
  const phase = useOpenMicPhase(isOpenMic ? contestSlug : '');

  const history = mergeStatusTimeline(timeline, workflow?.steps ?? []);

  const onWithdraw = async () => {
    const ok = await confirmAsync({
      title: 'Withdraw application?',
      message: 'This will withdraw your application from the contest. This cannot be undone.',
      confirmLabel: 'Withdraw',
      destructive: true,
    });
    if (!ok) return;
    withdraw.mutate(undefined, {
      onError: () => alertAsync({ title: 'Couldn’t withdraw', message: 'Please try again.' }),
    });
  };

  if (statusQuery.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Application status" />
        <StateView kind="loading" message="Loading status…" />
      </SafeAreaView>
    );
  }

  if (statusQuery.isError || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Application status" />
        <StateView kind="error" title="Couldn’t load status" actionLabel="Retry" onAction={() => statusQuery.refetch()} />
      </SafeAreaView>
    );
  }

  const canWithdraw = !TERMINAL.includes(draft.status);
  const awaitingPayment = draft.status === 'awaiting_payment';
  const needsInfo = draft.status === 'more_information_requested';

  const contestant = votingQuery.data?.contestant ?? null;
  const displayName =
    contestant?.stageName?.trim() ||
    contestant?.name?.trim() ||
    [draft.formData['personal.firstName'], draft.formData['personal.lastName']]
      .map((part) => String(part ?? '').trim())
      .filter(Boolean)
      .join(' ') ||
    'Your entry';

  const refreshAll = () => {
    statusQuery.refetch();
    votingQuery.refetch();
    refreshWorkflow();
    if (isOpenMic) phase.refresh();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Application status" subtitle={draft.reference} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={statusQuery.isRefetching || votingQuery.isRefetching}
            onRefresh={refreshAll}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={[styles.headCard, shadow1]}>
          <View style={styles.identityRow}>
            {/* The picture they uploaded, from their own answers or the roster row
                approval wrote. Never the KYC document. */}
            <ProfilePhotoAvatar
              formData={draft.formData}
              rosterPhoto={contestant?.photoUrl}
              name={displayName}
            />
            <View style={styles.identityText}>
              <Text style={styles.name}>{displayName}</Text>
              <Text style={styles.contest}>{String(draft.formData['contest.title'] || draft.contestSlug)}</Text>
            </View>
          </View>
          <StatusChip status={draft.status} />
          <Text style={styles.ref}>Reference: {draft.reference}</Text>
        </View>

        {awaitingPayment && (
          <View style={[styles.notice, styles.noticeWarn]}>
            <Text style={styles.noticeText}>Your entry is awaiting payment of the registration fee. Complete payment to be reviewed.</Text>
          </View>
        )}
        {needsInfo && (
          <View style={[styles.notice, styles.noticeWarn]}>
            <Text style={styles.noticeText}>
              The review team requested more information.
              {draft.formData['admin.reviewNote'] ? ` ${String(draft.formData['admin.reviewNote'])}` : ''}
            </Text>
          </View>
        )}

        {isOpenMic && (
          <OpenMicBanner
            title={
              workflow?.edition?.title ||
              String(draft.formData['contest.title'] ?? '') ||
              'Spotlight Open Mic'
            }
            subtitle={workflow?.edition?.description ?? null}
            imageUrl={votingQuery.data?.contest?.bannerImageUrl ?? null}
          />
        )}

        {votingQuery.data && <ContestVotingCard voting={votingQuery.data} />}

        {/* Open Mic only: the beat download and the song hand-in are the two
            steps this screen used to be silent about, even though they are what
            turns an approved application into a song voters can hear. */}
        {isOpenMic && (
          <OpenMicPhasePanel
            phase={phase}
            contestSlug={contestSlug}
            onChanged={() => {
              refreshWorkflow();
              votingQuery.refetch();
            }}
          />
        )}

        <Text style={styles.sectionTitle}>Status history</Text>
        {history.length === 0 ? (
          <Text style={styles.empty}>No status updates yet.</Text>
        ) : (
          <View style={styles.timeline}>
            {history.map((entry, i) => (
              <View key={entry.key} style={styles.timelineRow}>
                <View style={styles.timelineMarker}>
                  <View style={[styles.dot, i === 0 && styles.dotActive]} />
                  {i < history.length - 1 && <View style={styles.line} />}
                </View>
                <View style={styles.timelineBody}>
                  <Text style={styles.timelineStatus}>{entry.title}</Text>
                  {entry.note ? <Text style={styles.timelineNote}>{entry.note}</Text> : null}
                  {entry.at ? <Text style={styles.timelineDate}>{formatStamp(entry.at)}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {canWithdraw && (
        <View style={styles.footer}>
          <PrimaryButton label="Withdraw application" variant="danger" onPress={onWithdraw} loading={withdraw.isPending} />
          {draft.status === 'draft' && (
            <PrimaryButton label="Continue editing" variant="secondary" onPress={() => router.replace(`/registration/${appId}/wizard` as never)} />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  headCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.sm,
  },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  identityText: { flex: 1, gap: 2 },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  contest: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  ref: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  notice: { borderRadius: Radius.md, padding: Spacing.md },
  noticeWarn: { backgroundColor: Colors.iconBgGold },
  noticeText: { ...Typography.labelMd, color: Colors.onSurface },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  empty: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  timeline: { gap: 0 },
  timelineRow: { flexDirection: 'row', gap: Spacing.md },
  timelineMarker: { alignItems: 'center', width: 16 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.outlineVariant, marginTop: 4 },
  dotActive: { backgroundColor: Colors.primary },
  line: { width: 2, flex: 1, backgroundColor: Colors.surfaceContainerHigh, marginVertical: 2 },
  timelineBody: { flex: 1, paddingBottom: Spacing.lg },
  timelineStatus: { ...Typography.labelLg, color: Colors.onSurface },
  timelineNote: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: 2 },
  timelineDate: { ...Typography.labelSm, color: Colors.outline, marginTop: 2 },
  footer: {
    padding: Spacing.containerMargin, gap: Spacing.sm,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh,
  },
});
