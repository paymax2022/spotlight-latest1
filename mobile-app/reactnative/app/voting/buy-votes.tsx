import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { useVotePackages } from '@/features/voting/hooks/useVotePackages';
import { useContestDetails } from '@/features/voting/hooks/useContestDetails';
import { getVotingWindow } from '@/features/voting/utils/votingWindow';
import { getPaidVotingAvailability } from '@/features/voting/utils/paidVoting';
import VotePackageCard from '@/features/voting/components/VotePackageCard';
import { formatAmount } from '@/features/voting/utils/voteFormatters';
import type { VotePackage } from '@/features/voting/types/voting.types';
import { HomeMenuButton } from '@/components/HomeMenu';

export default function BuyVotesScreen() {
  const { contestantId, contestId } = useLocalSearchParams<{ contestantId: string; contestId: string }>();
  const { data: packages } = useVotePackages(contestId);
  const { data: contest } = useContestDetails(contestId ?? '');
  const [selected, setSelected] = useState<VotePackage | null>(null);

  const pkgs = packages ?? [];
  // Deadline-aware and shared with the screen that links here, so the two cannot
  // disagree. Status alone let an expired contest through — getVotingWindow
  // treats an unloaded contest as open, so a pending query still does not block.
  const votingWindow = getVotingWindow(contest);

  // Gates on what is actually purchasable — a per-vote price OR a package — not
  // on a flag the admin console does not write. See getPaidVotingAvailability.
  const paidVoting = getPaidVotingAvailability(contest, packages);
  const votingClosed = !votingWindow.open || paidVoting.available === false;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack(`/voting/contestant-profile?contestantId=${contestantId}&contestId=${contestId}`)} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>Buy Vote Packages</Text>
        <HomeMenuButton />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={styles.sub}>Select a package and vote for your favourite contestant</Text>

        {votingClosed && (
          <View style={styles.closedBanner}>
            <Lock size={16} color={Colors.error} strokeWidth={2} />
            <Text style={styles.closedText}>
              {votingWindow.message ??
                'No vote packages are on sale for this contest yet.'}
            </Text>
          </View>
        )}

        {/* Paid voting can be "available" because the contest sets a per-vote
            price (paid_vote_kobo > 0) while having no packages on sale. That
            combination suppressed the closed banner AND rendered an empty grid,
            so the screen came up blank with a "Select a package" button that did
            nothing. Say what is actually true instead. */}
        {!votingClosed && pkgs.length === 0 && (
          <View style={styles.closedBanner}>
            <Lock size={16} color={Colors.error} strokeWidth={2} />
            <Text style={styles.closedText}>
              No vote packages are on sale for this contest yet. Please check back later.
            </Text>
          </View>
        )}

        <View style={styles.grid}>
          {pkgs.map((pkg) => (
            <VotePackageCard
              key={pkg.id}
              pkg={pkg}
              selected={selected?.id === pkg.id}
              onPress={() => setSelected(pkg)}
            />
          ))}
        </View>

        {selected && (
          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Votes</Text>
              <Text style={styles.summaryValue}>{selected.votes + (selected.bonusVotes ?? 0)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Amount</Text>
              <Text style={[styles.summaryValue, { color: Colors.primary }]}>{formatAmount(selected.amount)}</Text>
            </View>
            <View style={styles.divider} />
            <Text style={styles.secureNote}>🔒 Secure & encrypted payment</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={
            votingClosed
              ? 'Voting is closed'
              : pkgs.length === 0
                ? 'No packages available'
                : selected
                  ? `Continue · ${formatAmount(selected.amount)}`
                  : 'Select a package'
          }
          onPress={() => {
            if (!selected || votingClosed) return;
            router.push(
              `/voting/payment-method?contestantId=${contestantId}&contestId=${contestId}&votes=${selected.votes + (selected.bonusVotes ?? 0)}&amount=${selected.amount}&packageId=${selected.id}`,
            );
          }}
          disabled={!selected || votingClosed}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Colors.background },
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  backBtn:  { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  title:    { ...Typography.titleLg, color: Colors.onSurface },
  content:  { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 120 },
  sub:      { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  grid:     { gap: Spacing.sm },
  summary:  { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  summaryValue: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  divider:  { height: 1, backgroundColor: Colors.surfaceContainerHigh },
  secureNote: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  closedBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md },
  closedText: { ...Typography.labelSm, color: Colors.error, flex: 1, lineHeight: 18 },
  footer:   { position: 'absolute', bottom: 0, left: 0, right: 0, padding: Spacing.containerMargin, paddingBottom: Platform.OS === 'ios' ? 34 : Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
