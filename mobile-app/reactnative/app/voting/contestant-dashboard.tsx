import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Share2, QrCode, Download } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import { useContestantProfile } from '@/features/voting/hooks/useContestantProfile';
import ContestantStatsCard from '@/features/voting/components/ContestantStatsCard';
import ShareBottomSheet from '@/features/voting/components/ShareBottomSheet';
import RankBadge from '@/features/voting/components/RankBadge';
import { formatVoteCount } from '@/features/voting/utils/voteFormatters';

export default function ContestantDashboardScreen() {
  const { contestantId } = useLocalSearchParams<{ contestantId: string }>();
  const [shareOpen, setShareOpen] = React.useState(false);
  const { data: contestant } = useContestantProfile(contestantId ?? '');

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
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
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
