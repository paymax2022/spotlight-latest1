import React from 'react';
import {
  ScrollView, View, Text, StyleSheet, Pressable, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Users, Trophy, Share2, ShieldCheck, Calendar } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import { formatDate } from '@/features/voting/utils/voteFormatters';
import { useContestDetails } from '@/features/voting/hooks/useContestDetails';
import { useContestants } from '@/features/voting/hooks/useContestants';
import ContestHero from '@/features/voting/components/ContestHero';
import SponsorBanner from '@/features/voting/components/SponsorBanner';
import ContestantCard from '@/features/voting/components/ContestantCard';
import VotingRulesCard from '@/features/voting/components/VotingRulesCard';
import ContestStatusBadge from '@/features/voting/components/ContestStatusBadge';
import ShareBottomSheet from '@/features/voting/components/ShareBottomSheet';

export default function ContestDetailsScreen() {
  const { contestId } = useLocalSearchParams<{ contestId: string }>();
  const [shareOpen, setShareOpen] = React.useState(false);

  const { data: contest, isLoading, isError } = useContestDetails(contestId ?? '');
  const { data: contestants } = useContestants(contestId ?? '');
  const preview = (contestants ?? []).slice(0, 4);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  if (isError || !contest) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Could not load contest. Please try again.</Text>
          <Pressable onPress={() => goBack('/voting')} style={styles.backLink}>
            <Text style={styles.backLinkText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Floating back + share */}
      <View style={styles.floatingBar}>
        <Pressable onPress={() => goBack('/voting')} style={styles.floatBtn}>
          <ArrowLeft size={20} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Pressable onPress={() => setShareOpen(true)} style={styles.floatBtn}>
          <Share2 size={20} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Hero */}
        <ContestHero contest={contest} height={300} />

        <View style={styles.body}>
          {/* Description */}
          {contest.description && (
            <View style={[styles.section, shadow1]}>
              <Text style={styles.sectionTitle}>About this Contest</Text>
              <Text style={styles.description}>{contest.description}</Text>
            </View>
          )}

          {/* Stats */}
          <View style={[styles.statsCard, shadow1]}>
            <View style={styles.stat}>
              <Users size={20} color={Colors.primary} strokeWidth={1.5} />
              <Text style={styles.statValue}>{contest.contestantCount}</Text>
              <Text style={styles.statLabel}>Contestants</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Trophy size={20} color={Colors.primary} strokeWidth={1.5} />
              <Text style={styles.statValue}>{contest.freeVotesPerDay}</Text>
              <Text style={styles.statLabel}>Free/contestant/day</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <ShieldCheck size={20} color={contest.paidVotingEnabled ? Colors.teal : Colors.outline} strokeWidth={1.5} />
              <Text style={styles.statValue}>{contest.paidVotingEnabled ? 'Yes' : 'No'}</Text>
              <Text style={styles.statLabel}>Paid Voting</Text>
            </View>
          </View>

          {/* Voting window */}
          <View style={[styles.section, styles.windowRow, shadow1]}>
            <Calendar size={18} color={Colors.primary} strokeWidth={1.5} />
            <Text style={styles.windowText}>
              {contest.endsAt
                ? `Voting closes ${formatDate(contest.endsAt)}`
                : 'No end date set for this contest yet'}
            </Text>
          </View>

          {/* Prizes */}
          {contest.prizes && contest.prizes.length > 0 && (
            <View style={[styles.section, shadow1]}>
              <Text style={styles.sectionTitle}>Prizes</Text>
              {contest.prizes.map((prize, i) => (
                <View key={i} style={styles.prizeRow}>
                  <View style={[styles.prizeDot, i === 0 && styles.prizeDotGold]} />
                  <Text style={styles.prizeText}>{prize}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Sponsor */}
          {contest.sponsorName && (
            <SponsorBanner sponsorName={contest.sponsorName} />
          )}

          {/* Contestants preview */}
          {preview.length > 0 && (
            <>
              <View style={styles.row}>
                <Text style={styles.sectionHeading}>Top Contestants</Text>
                <Pressable onPress={() => router.push(`/voting/contestants?contestId=${contest.id}`)}>
                  <Text style={styles.seeAll}>See all</Text>
                </Pressable>
              </View>
              <View style={styles.contestantsGrid}>
                {preview.map((c) => (
                  <View key={c.id} style={styles.contestantItem}>
                    <ContestantCard
                      contestant={c}
                      onPress={() => router.push(`/voting/contestant-profile?contestantId=${c.id}&contestId=${contest.id}`)}
                      onVote={() => router.push(`/voting/contestant-profile?contestantId=${c.id}&contestId=${contest.id}`)}
                    />
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Voting rules */}
          <VotingRulesCard freeVotesPerDay={contest.freeVotesPerDay} rulesText={contest.rulesText} />

          {/* CTA */}
          <View style={styles.ctaRow}>
            <PrimaryButton
              label="Register / Apply to Compete"
              onPress={() => router.push({ pathname: '/registration', params: { contestId: contest.id, contestTitle: contest.title } } as never)}
            />
            <PrimaryButton
              label="View All Contestants"
              onPress={() => router.push(`/voting/contestants?contestId=${contest.id}`)}
              variant="secondary"
            />
            {contest.showLeaderboard !== false && (
              <PrimaryButton
                label="View Leaderboard"
                onPress={() => router.push(`/voting/leaderboard?contestId=${contest.id}`)}
                variant="secondary"
              />
            )}
          </View>
        </View>
      </ScrollView>

      <ShareBottomSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        contestantName={contest.title}
        shareText={`Vote in ${contest.title} on Spotlight! 🏆`}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  loader:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBox:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.lg },
  errorText:  { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  backLink:   {},
  backLinkText: { ...Typography.labelMd, color: Colors.primary },
  floatingBar:{ position: 'absolute', top: Platform.OS === 'ios' ? 54 : 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, zIndex: 10 },
  floatBtn:   { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  content:    { paddingBottom: 100 },
  body:       { padding: Spacing.containerMargin, gap: Spacing.md },
  section:    { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  description:  { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 26 },
  statsCard:  { flexDirection: 'row', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  stat:       { flex: 1, alignItems: 'center', gap: 4 },
  statValue:  { ...Typography.titleLg, color: Colors.onSurface, fontWeight: '700' as const },
  statLabel:  { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  statDivider: { width: 1, backgroundColor: Colors.surfaceContainerHigh },
  windowRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
  windowText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  prizeRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  prizeDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.onSurfaceVariant },
  prizeDotGold: { backgroundColor: '#F59E0B' },
  prizeText:  { ...Typography.bodyMd, color: Colors.onSurface },
  row:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionHeading: { ...Typography.titleMd, color: Colors.onSurface },
  seeAll:     { ...Typography.labelMd, color: Colors.primary },
  contestantsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  contestantItem: { width: '48%' },
  ctaRow:     { gap: Spacing.sm },
});
