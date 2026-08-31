import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import StatusChip from '@/features/registration/components/StatusChip';
import { useStatus, useWithdraw, useRegistrationVoting } from '@/features/registration/hooks/useRegistration';
import ContestVotingCard from '@/features/registration/components/ContestVotingCard';
import { statusLabel } from '@/features/registration/utils/status';
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

  const draft = statusQuery.data?.draft;
  const timeline = statusQuery.data?.timeline ?? [];

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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Application status" subtitle={draft.reference} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={statusQuery.isRefetching || votingQuery.isRefetching}
            onRefresh={() => { statusQuery.refetch(); votingQuery.refetch(); }}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={[styles.headCard, shadow1]}>
          <Text style={styles.contest}>{String(draft.formData['contest.title'] || draft.contestSlug)}</Text>
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

        {votingQuery.data && <ContestVotingCard voting={votingQuery.data} />}

        <Text style={styles.sectionTitle}>Status history</Text>
        {timeline.length === 0 ? (
          <Text style={styles.empty}>No status updates yet.</Text>
        ) : (
          <View style={styles.timeline}>
            {[...timeline].reverse().map((ev, i) => (
              <View key={ev.id} style={styles.timelineRow}>
                <View style={styles.timelineMarker}>
                  <View style={[styles.dot, i === 0 && styles.dotActive]} />
                  {i < timeline.length - 1 && <View style={styles.line} />}
                </View>
                <View style={styles.timelineBody}>
                  <Text style={styles.timelineStatus}>{statusLabel(ev.newStatus)}</Text>
                  {ev.note ? <Text style={styles.timelineNote}>{ev.note}</Text> : null}
                  <Text style={styles.timelineDate}>{formatDate(ev.createdAt)}</Text>
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  headCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, gap: Spacing.sm,
  },
  contest: { ...Typography.titleLg, color: Colors.onSurface },
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
