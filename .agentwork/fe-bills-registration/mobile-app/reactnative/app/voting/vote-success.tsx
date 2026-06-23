import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import PrimaryButton from '@/components/PrimaryButton';
import { useContestantProfile } from '@/features/voting/hooks/useContestantProfile';
import VoteSuccessCard from '@/features/voting/components/VoteSuccessCard';
import ShareBottomSheet from '@/features/voting/components/ShareBottomSheet';

export default function VoteSuccessScreen() {
  const { contestantId, contestId, votes } =
    useLocalSearchParams<{ contestantId: string; contestId: string; votes: string; voteType: string }>();
  const [shareOpen, setShareOpen] = React.useState(false);
  const { data: contestant } = useContestantProfile(contestantId ?? '');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <VoteSuccessCard
          contestantName={contestant?.stageName ?? contestant?.name ?? 'your contestant'}
          contestantPhoto={contestant?.photo}
          votesCast={Number(votes ?? 0)}
          newRank={contestant?.rank}
          newVoteTotal={contestant?.votes}
        />

        <View style={styles.actions}>
          <PrimaryButton
            label="Share & Spread the Word"
            onPress={() => setShareOpen(true)}
          />
          <PrimaryButton
            label="Vote Again"
            onPress={() => router.back()}
            variant="secondary"
          />
          <PrimaryButton
            label="View Leaderboard"
            onPress={() => router.push(`/voting/leaderboard?contestId=${contestId}`)}
            variant="ghost"
          />
        </View>
      </View>

      <ShareBottomSheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        contestantName={contestant?.stageName ?? contestant?.name ?? 'Contestant'}
        shareText={`I just voted for ${contestant?.stageName ?? contestant?.name} in the Spotlight Contest! Join me! 🎤🏆`}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, padding: Spacing.containerMargin, justifyContent: 'space-between' },
  actions: { gap: Spacing.sm, paddingBottom: Platform.OS === 'ios' ? 8 : 0 },
});
