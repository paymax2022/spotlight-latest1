import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Share2, QrCode, Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import { VotingColors } from '@/features/voting/constants/voting.constants';
import { useContestantProfile } from '@/features/voting/hooks/useContestantProfile';
import { useContestantSupporters } from '@/features/voting/hooks/useContestantSupporters';
import ContestantStatsCard from '@/features/voting/components/ContestantStatsCard';
import ShareBottomSheet from '@/features/voting/components/ShareBottomSheet';
import RankBadge from '@/features/voting/components/RankBadge';
import { formatVoteCount, formatDate } from '@/features/voting/utils/voteFormatters';

export default function ContestantDashboardScreen() {
  const { contestantId } = useLocalSearchParams<{ contestantId: string }>();
  const [shareOpen, setShareOpen] = React.useState(false);
  const { data: contestant } = useContestantProfile(contestantId ?? '');
  // Contestant-private: the server refuses anyone else, so an error here just
  // means "not your campaign" and the section stays hidden.
  const supporters = useContestantSupporters(contestantId);

  if (!contestant) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loader}><Text style={styles.loaderText}>Loading dashboard…</Text></View>
      </SafeAreaView>
    );
  }

  const votesToNextRank = contestant.votesNeededToNextRank ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/voting')} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>My Campaign</Text>
        <Pressable onPress={() => setShareOpen(true)} style={styles.backBtn}>
          <Share2 size={20} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Summary hero */}
        <View style={[styles.heroCard, shadow1]}>
          <View style={styles.heroRow}>
            <RankBadge rank={contestant.rank} size="lg" />
            <View style={styles.heroInfo}>
              <Text style={styles.heroName}>{contestant.stageName ?? contestant.name}</Text>
              <Text style={styles.heroVotes}>{formatVoteCount(contestant.votes)} total votes</Text>
            </View>
          </View>
          {votesToNextRank > 0 && (
            <View style={styles.progressHint}>
              <Text style={styles.progressText}>
                {formatVoteCount(votesToNextRank)} votes needed to reach #{contestant.rank - 1}
              </Text>
            </View>
          )}
        </View>

        {/* Stats */}
        <ContestantStatsCard contestant={contestant} />

        {/* Who voted for you. Rendered only when the server actually returned a
            list — for any other viewer it answers 403 and this stays hidden,
            so the section is its own authorisation signal. */}
        {supporters.data && supporters.data.length > 0 ? (
          <View style={[styles.supportersCard, shadow1]}>
            <Text style={styles.supportersTitle}>
              Who voted for you ({supporters.data.length})
            </Text>
            {supporters.data.slice(0, 25).map((s, i) => (
              <View key={`${s.createdAt}-${i}`} style={[styles.supporterRow, i > 0 && styles.supporterDivider]}>
                <View style={{ flex: 1 }}>
                  {/* An anonymous free vote arrives with no name at all — the
                      server blanks it rather than trusting this screen to. */}
                  <Text style={[styles.supporterName, s.anonymous && styles.supporterAnon]} numberOfLines={1}>
                    {s.anonymous ? 'Anonymous voter' : s.voterName}
                  </Text>
                  <Text style={styles.supporterMeta}>{formatDate(s.createdAt)}</Text>
                </View>
                <View style={styles.supporterRight}>
                  <Text style={styles.supporterVotes}>+{s.quantity}</Text>
                  <Text style={[styles.supporterType, s.paid ? { color: Colors.secondary } : { color: VotingColors.freeVote }]}>
                    {s.paid ? 'Paid' : 'Free'}
                  </Text>
                </View>
              </View>
            ))}
            {supporters.data.length > 25 ? (
              <Text style={styles.supporterMore}>
                Showing the 25 most recent of {supporters.data.length}.
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Share profile */}
        <View style={[styles.shareCard, shadow1]}>
          <Text style={styles.shareTitle}>Grow Your Votes</Text>
          <Text style={styles.shareSub}>Share your profile with your fans and family to get more votes.</Text>
          <PrimaryButton label="Share My Profile" onPress={() => setShareOpen(true)} />
        </View>

        {/* QR & Flyer placeholders */}
        <View style={styles.actionsRow}>
          <Pressable style={[styles.actionCard, shadow1]}>
            <QrCode size={28} color={Colors.primary} strokeWidth={1.5} />
            <Text style={styles.actionLabel}>My QR Code</Text>
            <Text style={styles.actionSub}>Coming soon</Text>
          </Pressable>
          <Pressable style={[styles.actionCard, shadow1]}>
            <Download size={28} color={Colors.secondary} strokeWidth={1.5} />
            <Text style={styles.actionLabel}>Campaign Flyer</Text>
            <Text style={styles.actionSub}>Coming soon</Text>
          </Pressable>
        </View>
      </ScrollView>

      <ShareBottomSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        contestantName={contestant.stageName ?? contestant.name}
        shareText={`Vote for ${contestant.stageName ?? contestant.name} on Spotlight! 🎤 Every vote counts!`}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  backBtn:   { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  title:     { ...Typography.titleLg, color: Colors.onSurface },
  loader:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loaderText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  content:   { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 100 },
  heroCard:  { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.md },
  heroRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  heroInfo:  { flex: 1 },
  heroName:  { ...Typography.titleLg, color: Colors.onSurface },
  heroVotes: { ...Typography.bodyMd, color: Colors.primary, fontWeight: '600' as const },
  supportersCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, marginBottom: Spacing.md, gap: 2,
  },
  supportersTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  supporterRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  supporterDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  supporterName: { ...Typography.labelMd, color: Colors.onSurface },
  supporterAnon: { color: Colors.onSurfaceVariant, fontStyle: 'italic' as const },
  supporterMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  supporterRight: { alignItems: 'flex-end' },
  supporterVotes: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
  supporterType: { ...Typography.labelSm },
  supporterMore: { ...Typography.labelSm, color: Colors.onSurfaceVariant, paddingTop: Spacing.xs },
  progressHint: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm },
  progressText: { ...Typography.labelSm, color: Colors.primary, textAlign: 'center' },
  shareCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.sm },
  shareTitle: { ...Typography.titleMd, color: Colors.onSurface },
  shareSub:  { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  actionsRow: { flexDirection: 'row', gap: Spacing.md },
  actionCard: { flex: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  actionLabel: { ...Typography.labelMd, color: Colors.onSurface },
  actionSub:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
