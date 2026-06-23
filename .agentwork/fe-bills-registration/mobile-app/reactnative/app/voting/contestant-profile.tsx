import React, { useState } from 'react';
import {
  ScrollView, View, Text, StyleSheet, Pressable, ActivityIndicator, Image, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Share2, Heart, BadgeCheck, MapPin, Music } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import { useContestantProfile } from '@/features/voting/hooks/useContestantProfile';
import { useFreeVoteAllocation, useCastFreeVotes } from '@/features/voting/hooks/useVote';
import { useVotePackages } from '@/features/voting/hooks/useVotePackages';
import RankBadge from '@/features/voting/components/RankBadge';
import RankMovementBadge from '@/features/voting/components/RankMovementBadge';
import FreeVoteBadge from '@/features/voting/components/FreeVoteBadge';
import ContestantStatsCard from '@/features/voting/components/ContestantStatsCard';
import VoteConfirmationSheet from '@/features/voting/components/VoteConfirmationSheet';
import ShareBottomSheet from '@/features/voting/components/ShareBottomSheet';
import { formatVoteCount } from '@/features/voting/utils/voteFormatters';
import type { VotePackage } from '@/features/voting/types/voting.types';
import { MOCK_FREE_VOTE_ALLOCATION, MOCK_VOTE_PACKAGES } from '@/features/voting/api/voting.mock';

export default function ContestantProfileScreen() {
  const { contestantId, contestId } = useLocalSearchParams<{ contestantId: string; contestId: string }>();
  const [voteOpen, setVoteOpen]   = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const { data: contestant, isLoading } = useContestantProfile(contestantId ?? '');
  const { data: freeVotes }  = useFreeVoteAllocation(contestId ?? '');
  const { data: packages }   = useVotePackages(contestId);
  const castFree = useCastFreeVotes();
  const qc = useQueryClient();

  const handleFreeVote = async (votes: number) => {
    if (!contestant) return;
    try {
      await castFree.mutateAsync({ contestantId: contestant.id, contestId: contestId ?? '', votes });
      setVoteOpen(false);
      router.push(`/voting/vote-success?contestantId=${contestant.id}&contestId=${contestId}&votes=${votes}&voteType=FREE`);
    } catch {
      router.push('/voting/vote-failed');
    }
  };

  const handlePaidVote = (pkg: VotePackage, votes: number) => {
    setVoteOpen(false);
    router.push(
      `/voting/payment-method?contestantId=${contestantId}&contestId=${contestId}&votes=${votes}&amount=${pkg.amount}&packageId=${pkg.id}`,
    );
  };

  if (isLoading || !contestant) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  const displayFreeVotes = freeVotes ?? MOCK_FREE_VOTE_ALLOCATION;
  const displayPackages  = packages  ?? MOCK_VOTE_PACKAGES;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Floating controls */}
      <View style={styles.floatingBar}>
        <Pressable onPress={() => router.back()} style={styles.floatBtn}>
          <ArrowLeft size={20} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.floatRight}>
          <Pressable onPress={() => setShareOpen(true)} style={styles.floatBtn}>
            <Share2 size={20} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
          <Pressable style={styles.floatBtn}>
            <Heart size={20} color={Colors.error} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Hero image */}
        <View style={styles.heroWrap}>
          {contestant.photo ? (
            <Image source={{ uri: contestant.photo }} style={styles.heroImage} resizeMode="cover" />
          ) : (
            <View style={[styles.heroImage, styles.heroPh]}>
              <Text style={styles.heroInitial}>{contestant.name.charAt(0)}</Text>
            </View>
          )}
          <View style={styles.heroOverlay}>
            <View style={styles.heroRank}>
              <RankBadge rank={contestant.rank} size="lg" />
              <RankMovementBadge movement={contestant.movement} />
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {/* Name & identity */}
          <View style={styles.nameBlock}>
            <View style={styles.nameRow}>
              <Text style={styles.stageName}>{contestant.stageName ?? contestant.name}</Text>
              {contestant.isVerified && (
                <BadgeCheck size={20} color={Colors.secondary} fill={Colors.secondary} strokeWidth={0} />
              )}
            </View>
            <Text style={styles.realName}>{contestant.name}</Text>
            <View style={styles.tagsRow}>
              {contestant.state && (
                <View style={styles.tag}>
                  <MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={styles.tagText}>{contestant.state}</Text>
                </View>
              )}
              {contestant.category && (
                <View style={styles.tag}>
                  <Music size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={styles.tagText}>{contestant.category}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Vote stats strip */}
          <View style={[styles.voteStrip, shadow1]}>
            <Text style={styles.voteCount}>{formatVoteCount(contestant.votes)}</Text>
            <Text style={styles.voteLabel}>Total Votes</Text>
            <View style={styles.stripDivider} />
            <FreeVoteBadge remaining={displayFreeVotes.remaining} total={displayFreeVotes.total} />
          </View>

          {/* Bio */}
          {contestant.bio && (
            <View style={[styles.section, shadow1]}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.bio}>{contestant.bio}</Text>
            </View>
          )}

          {/* Stats */}
          <ContestantStatsCard contestant={contestant} />

          {/* Vote CTA */}
          <View style={styles.ctaBlock}>
            <PrimaryButton
              label={`Vote for ${contestant.stageName ?? contestant.name}`}
              onPress={() => setVoteOpen(true)}
              style={styles.voteBtn}
            />
            <PrimaryButton
              label="Buy Vote Packages"
              onPress={() => router.push(`/voting/buy-votes?contestantId=${contestant.id}&contestId=${contestId}`)}
              variant="secondary"
            />
          </View>
        </View>
      </ScrollView>

      <VoteConfirmationSheet
        visible={voteOpen}
        onClose={() => setVoteOpen(false)}
        contestant={contestant}
        freeVotes={displayFreeVotes}
        packages={displayPackages}
        onConfirmFree={handleFreeVote}
        onConfirmPaid={handlePaidVote}
        isFreeLoading={castFree.isPending}
      />

      <ShareBottomSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        contestantName={contestant.stageName ?? contestant.name}
        shareText={`Vote for ${contestant.stageName ?? contestant.name} in the Spotlight Contest! 🎤`}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  loader:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  floatingBar: { position: 'absolute', top: Platform.OS === 'ios' ? 54 : 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, zIndex: 10 },
  floatBtn:    { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  floatRight:  { flexDirection: 'row', gap: Spacing.sm },
  heroWrap:    { height: 320, position: 'relative' },
  heroImage:   { width: '100%', height: '100%' },
  heroPh:      { backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  heroInitial: { ...Typography.displayLg, color: Colors.onPrimaryContainer },
  heroOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', padding: Spacing.lg },
  heroRank:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  content:     { paddingBottom: 100 },
  body:        { padding: Spacing.containerMargin, gap: Spacing.md },
  nameBlock:   { gap: 4 },
  nameRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stageName:   { ...Typography.headlineMd, color: Colors.onSurface },
  realName:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  tagsRow:     { flexDirection: 'row', gap: Spacing.sm, marginTop: 6 },
  tag:         { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLow, paddingVertical: 4, paddingHorizontal: Spacing.sm, borderRadius: Radius.full },
  tagText:     { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  voteStrip:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  voteCount:   { ...Typography.titleLg, color: Colors.primary, fontWeight: '700' as const },
  voteLabel:   { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  stripDivider: { width: 1, height: 28, backgroundColor: Colors.surfaceContainerHigh },
  section:     { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  bio:         { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 26 },
  ctaBlock:    { gap: Spacing.sm },
  voteBtn:     {},
});
