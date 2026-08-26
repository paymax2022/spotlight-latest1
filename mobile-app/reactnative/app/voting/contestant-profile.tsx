import React, { useState } from 'react';
import {
  ScrollView, View, Text, StyleSheet, Pressable, ActivityIndicator, Image, Platform, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Share2, Heart, BadgeCheck, MapPin, Music, PlayCircle, ExternalLink } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import { useContestantProfile } from '@/features/voting/hooks/useContestantProfile';
import { useContestDetails } from '@/features/voting/hooks/useContestDetails';
import { useFreeVoteAllocation, useCastFreeVotes } from '@/features/voting/hooks/useVote';
import { useVotePackages } from '@/features/voting/hooks/useVotePackages';
import RankBadge from '@/features/voting/components/RankBadge';
import RankMovementBadge from '@/features/voting/components/RankMovementBadge';
import FreeVoteBadge from '@/features/voting/components/FreeVoteBadge';
import FreeVoteResetCountdown from '@/features/voting/components/FreeVoteResetCountdown';
import ContestantStatsCard from '@/features/voting/components/ContestantStatsCard';
import VoteConfirmationSheet from '@/features/voting/components/VoteConfirmationSheet';
import ShareBottomSheet from '@/features/voting/components/ShareBottomSheet';
import { formatVoteCount } from '@/features/voting/utils/voteFormatters';
import type { VotePackage } from '@/features/voting/types/voting.types';

/**
 * The sample link is contestant-submitted registration data, so it is untrusted
 * input: only http(s) is allowed through. Without this check a crafted entry
 * could put a `javascript:` or `file:` URL in front of every voter who opens
 * the profile.
 */
function safeMediaUrl(raw?: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null; // not a parseable absolute URL
  }
}

/** "youtube.com" from a full URL — enough for the voter to see where it goes. */
function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'external link';
  }
}

export default function ContestantProfileScreen() {
  const { contestantId, contestId } = useLocalSearchParams<{ contestantId: string; contestId: string }>();
  const [voteOpen, setVoteOpen]   = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const { data: contestant, isLoading } = useContestantProfile(contestantId ?? '');
  const { data: parentContest } = useContestDetails(contestId ?? '');
  const { data: freeVotes }  = useFreeVoteAllocation(contestId ?? '', contestantId ?? '');
  const { data: packages }   = useVotePackages(contestId);

  // Organiser visibility (per-contest / per-phase). Default visible.
  const showVoteCount = parentContest?.showVoteCount !== false;
  const showRank      = parentContest?.showRank !== false;
  const castFree = useCastFreeVotes();
  const qc = useQueryClient();

  const sampleUrl = safeMediaUrl(contestant?.mediaUrl);
  const openSample = async () => {
    if (!sampleUrl) return;
    const ok = await Linking.canOpenURL(sampleUrl).catch(() => false);
    if (!ok) {
      Alert.alert('Cannot open link', 'No app on this device can open that link.');
      return;
    }
    Linking.openURL(sampleUrl).catch(() =>
      Alert.alert('Cannot open link', 'Something went wrong opening the performance sample.'),
    );
  };

  const handleFreeVote = async (votes: number) => {
    if (!contestant) return;
    try {
      await castFree.mutateAsync({ contestantId: contestant.id, contestId: contestId ?? '', votes });
      setVoteOpen(false);
      router.push(`/voting/vote-success?contestantId=${contestant.id}&contestId=${contestId}&votes=${votes}&voteType=FREE`);
    } catch (e: any) {
      setVoteOpen(false);
      const msg =
        e?.response?.data?.error ?? e?.response?.data?.message ?? 'We could not cast your vote. Please try again.';
      Alert.alert('Vote failed', msg);
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

  // NO MOCK FALLBACK. These previously read `?? MOCK_…`, which meant a live
  // response that was missing, empty or still loading silently rendered invented
  // vote packages — regardless of EXPO_PUBLIC_VOTING_USE_MOCK.
  //
  // That was not merely cosmetic: handlePaidVote builds the payment URL from
  // `pkg.amount` and `pkg.id`, so a tap on a fabricated package sent a real voter
  // into checkout with a price and a package id the server has never heard of.
  //
  // Absent data now reads as absent. Free-vote state falls back to a ZERO
  // allowance (never a generous invented one), and paid packages simply are not
  // offered until the server says what they are.
  // `freeVotes` stays possibly-undefined on purpose: "we do not know yet" and
  // "you have none left" are different facts, and the reset countdown below is
  // only truthful for the second one. Substituting a zero allowance would show a
  // countdown to a date the server never sent.
  const displayPackages: VotePackage[] = packages ?? [];

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
          {showRank && (
            <View style={styles.heroOverlay}>
              <View style={styles.heroRank}>
                <RankBadge rank={contestant.rank} size="lg" />
                <RankMovementBadge movement={contestant.movement} />
              </View>
            </View>
          )}
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
            <Text style={styles.voteCount}>{showVoteCount ? formatVoteCount(contestant.votes ?? 0) : '—'}</Text>
            <Text style={styles.voteLabel}>Total Votes</Text>
            <View style={styles.stripDivider} />
            {!freeVotes ? (
              // Unknown, not zero — say nothing rather than assert an allowance.
              <Text style={styles.voteLabel}>—</Text>
            ) : freeVotes.remaining === 0 ? (
              <FreeVoteResetCountdown
                resetAt={freeVotes.resetsAt}
                size="sm"
                onReset={() =>
                  qc.invalidateQueries({ queryKey: ['voting', 'free-votes', contestId] })
                }
              />
            ) : (
              <FreeVoteBadge remaining={freeVotes.remaining} total={freeVotes.total} />
            )}
          </View>

          {/* Bio */}
          {contestant.bio && (
            <View style={[styles.section, shadow1]}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.bio}>{contestant.bio}</Text>
            </View>
          )}

          {/* Performance sample — the link submitted with the entry. */}
          {sampleUrl && (
            <Pressable
              onPress={openSample}
              accessibilityRole="link"
              accessibilityLabel={`Watch performance sample on ${linkHost(sampleUrl)}`}
              style={({ pressed }) => [styles.section, shadow1, pressed && styles.samplePressed]}
            >
              <Text style={styles.sectionTitle}>Performance sample</Text>
              <View style={styles.sampleRow}>
                <PlayCircle size={20} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.sampleHost} numberOfLines={1}>{linkHost(sampleUrl)}</Text>
                <ExternalLink size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
              </View>
              <Text style={styles.sampleHint}>Opens outside the app</Text>
            </Pressable>
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
        // In the sheet an unknown allowance is treated as none: offering a free
        // vote the server has not authorised produces a failed cast and a
        // confusing error, which is worse than not offering it.
        freeVotes={freeVotes ?? { total: 0, used: 0, remaining: 0, resetsAt: '' }}
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
  samplePressed: { opacity: 0.7 },
  sampleRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sampleHost:  { ...Typography.bodyMd, color: Colors.primary, flex: 1 },
  sampleHint:  { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  ctaBlock:    { gap: Spacing.sm },
  voteBtn:     {},
});
