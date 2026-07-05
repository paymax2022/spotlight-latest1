import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Users, Coins, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { DisclosureCard } from '@/features/referral/components';
import { formatNaira, relativeTime } from '@/features/referral/constants/format';
import { useContests, useJoinContest } from '@/features/referral/gamification/hooks';
import type { Contest, ContestStatus } from '@/features/referral/gamification/types';

// M-GAM-06 — Contests & challenges. Time-bound competitions (e.g. World Cup).
const STATUS_META: Record<ContestStatus, { label: string; color: string; bg: string }> = {
  upcoming: { label: 'Upcoming', color: Colors.secondary,         bg: Colors.iconBgBlue },
  live:     { label: 'Live now', color: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  ended:    { label: 'Ended',    color: Colors.onSurfaceVariant,  bg: Colors.surfaceContainer },
};

export default function ContestsScreen() {
  const { data, isLoading, isError, refetch } = useContests();
  const join = useJoinContest();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Contests & challenges" />
      {isLoading ? (
        <StateView kind="loading" message="Loading contests…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <DisclosureCard
            tone="compliant"
            title="Win on real activity"
            body="Contest rankings count your friends' verified activity — never just signups. Prizes are awarded fairly and after fraud checks."
          />
          {data && data.length > 0 ? (
            data.map((c) => (
              <ContestCard
                key={c.id}
                contest={c}
                joining={join.isPending && join.variables === c.id}
                onJoin={() => join.mutate(c.id)}
              />
            ))
          ) : (
            <StateView kind="empty" icon="Medal" title="No contests" message="Time-bound challenges appear here." compact />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ContestCard({ contest, joining, onJoin }: { contest: Contest; joining: boolean; onJoin: () => void }) {
  const meta = STATUS_META[contest.status];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[contest.icon] ?? Icons.Trophy;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}><Icon size={24} color={Colors.primary} strokeWidth={2} /></View>
        <View style={styles.headText}>
          <Text style={styles.title} numberOfLines={1}>{contest.title}</Text>
          <Text style={styles.blurb} numberOfLines={2}>{contest.blurb}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: meta.bg }]}><Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text></View>
      </View>

      {/* Prize — explicit cash vs points */}
      <View style={styles.prizeRow}>
        {contest.prizePoolKobo != null ? (
          <View style={styles.prizeChip}><Coins size={14} color={Colors.tertiaryContainer} strokeWidth={2} /><Text style={styles.prizeCash}>{formatNaira(contest.prizePoolKobo)} pool</Text></View>
        ) : (
          <View style={[styles.prizeChip, styles.prizeChipPts]}><Sparkles size={14} color={Colors.secondary} strokeWidth={2} /><Text style={styles.prizePts}>{contest.prizeLabel}</Text></View>
        )}
        <View style={styles.participants}><Users size={13} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.participantsText}>{contest.participants.toLocaleString('en-NG')}</Text></View>
      </View>

      <Text style={styles.timing}>
        {contest.status === 'live' ? `Ends ${relativeTime(contest.endsAt)}` : contest.status === 'upcoming' ? `Starts ${relativeTime(contest.startsAt)}` : `Ended ${relativeTime(contest.endsAt)}`}
      </Text>

      {contest.status !== 'ended' ? (
        contest.joined ? (
          <View style={styles.joinedBadge}><Text style={styles.joinedText}>You're in</Text></View>
        ) : (
          <PrimaryButton label="Join contest" onPress={onJoin} loading={joining} variant="secondary" />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  head: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  icon: { width: 46, height: 46, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1, gap: 2 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  blurb: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  pill: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  pillText: { ...Typography.labelSm, fontWeight: '700' as const },
  prizeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  prizeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgTeal, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.full },
  prizeChipPts: { backgroundColor: Colors.iconBgBlue },
  prizeCash: { ...Typography.labelMd, color: Colors.tertiaryContainer, fontWeight: '700' as const },
  prizePts: { ...Typography.labelSm, color: Colors.secondary, fontWeight: '700' as const },
  participants: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  participantsText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  timing: { ...Typography.caption, color: Colors.onSurfaceVariant },
  joinedBadge: { alignSelf: 'flex-start', backgroundColor: Colors.iconBgTeal, paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full },
  joinedText: { ...Typography.labelSm, color: Colors.tertiaryContainer, fontWeight: '700' as const },
});
