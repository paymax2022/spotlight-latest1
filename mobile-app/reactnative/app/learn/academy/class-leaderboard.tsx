import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShieldCheck, Trophy } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useClassLeaderboard } from '@/features/academy/hooks';
import type { LeaderboardEntry } from '@/features/academy/types';

/**
 * Class XP leaderboard. Minor-safe by construction: the server scopes to the
 * learner's own class and returns first names only — no full names, no user ids,
 * no cross-school exposure. XP is earned on the practice/exam earn-path.
 */
export default function ClassLeaderboardScreen() {
  const board = useClassLeaderboard();
  const data = board.data;
  const entries = data?.entries ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Class leaderboard" subtitle={data?.classCode ? `Class ${data.classCode}` : 'Your class'} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.safeNote, shadow1]}>
          <ShieldCheck size={16} color={Colors.teal} />
          <Text style={styles.safeText}>Only your classmates appear here, by first name. Earn XP by practising and taking mock exams.</Text>
        </View>

        {board.isLoading ? (
          <StateView kind="loading" message="Loading rankings…" compact />
        ) : board.isError ? (
          <StateView kind="error" title="Couldn't load rankings" actionLabel="Retry" onAction={() => board.refetch()} />
        ) : entries.length === 0 ? (
          <StateView kind="empty" title="No rankings yet" message="Complete a practice set or mock exam to get on the board." />
        ) : (
          <>
            {data?.myRank ? (
              <View style={[styles.myRankCard, shadow1]}>
                <Trophy size={20} color={Colors.gold} />
                <Text style={styles.myRankText}>You&apos;re ranked #{data.myRank} in your class</Text>
              </View>
            ) : null}
            {entries.map((e) => <Row key={`${e.rank}-${e.name}`} e={e} />)}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ e }: { e: LeaderboardEntry }) {
  const podium = e.rank <= 3;
  return (
    <View style={[styles.row, shadow1, e.isMe && styles.rowMe]}>
      <View style={styles.rankWrap}><Text style={[styles.rank, podium && styles.rankPodiumText]}>{e.rank}</Text></View>
      <View style={styles.avatar}><Text style={styles.avatarText}>{(e.name.charAt(0) || '?').toUpperCase()}</Text></View>
      <Text style={[styles.name, e.isMe && styles.nameMe]} numberOfLines={1}>{e.name}{e.isMe ? ' (you)' : ''}</Text>
      <Text style={styles.score}>{e.xp.toLocaleString('en-NG')} XP</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  safeNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md },
  safeText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  myRankCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  myRankText: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  rowMe: { borderWidth: 1.5, borderColor: Colors.primary },
  rankWrap: { width: 30, alignItems: 'center' },
  rank: { ...Typography.titleMd, color: Colors.onSurfaceVariant },
  rankPodiumText: { color: Colors.gold, fontWeight: '700' },
  avatar: { width: 38, height: 38, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerHigh },
  avatarText: { ...Typography.labelLg, color: Colors.primary, fontWeight: '700' },
  name: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  nameMe: { color: Colors.primary },
  score: { ...Typography.titleMd, color: Colors.onSurface },
});
