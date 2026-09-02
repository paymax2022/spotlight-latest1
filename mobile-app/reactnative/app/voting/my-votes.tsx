import React, { useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { useMyVotes } from '@/features/voting/hooks/useMyVotes';
import { formatAmount, formatDate } from '@/features/voting/utils/voteFormatters';
import { VOTE_STATUS_LABELS, VotingColors } from '@/features/voting/constants/voting.constants';
import type { VoteType, VoteTransactionStatus } from '@/features/voting/types/voting.types';
import { HomeMenuButton } from '@/components/HomeMenu';

type Filter = 'ALL' | VoteType;
const FILTERS: { label: string; value: Filter }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Free', value: 'FREE' },
  { label: 'Paid', value: 'PAID' },
];

export default function MyVotesScreen() {
  const [filter, setFilter] = useState<Filter>('ALL');
  const { data, isLoading, refetch, isRefetching } = useMyVotes(
    filter !== 'ALL' ? { voteType: filter } : undefined,
  );

  const totalVotes = (data ?? []).reduce((s, t) => s + t.votes, 0);
  const freeVotes  = (data ?? []).filter((t) => t.voteType === 'FREE').reduce((s, t) => s + t.votes, 0);
  const paidVotes  = (data ?? []).filter((t) => t.voteType === 'PAID').reduce((s, t) => s + t.votes, 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/voting')} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <Text style={styles.title}>My Votes</Text>
        <HomeMenuButton />
      </View>

      {/* Summary */}
      <View style={[styles.summaryCard, shadow1]}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{totalVotes}</Text>
          <Text style={styles.statLabel}>Total Votes</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: VotingColors.freeVote }]}>{freeVotes}</Text>
          <Text style={styles.statLabel}>Free Votes</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: Colors.secondary }]}>{paidVotes}</Text>
          <Text style={styles.statLabel}>Paid Votes</Text>
        </View>
      </View>

      {/* Filters */}
      <View style={styles.filtersRow}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.value}
            onPress={() => setFilter(f.value)}
            style={[styles.filterChip, filter === f.value && styles.filterChipActive]}
          >
            <Text style={[styles.filterLabel, filter === f.value && styles.filterLabelActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.loader}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(t) => t.id}
          renderItem={({ item: tx }) => {
            const statusColor = tx.status === 'SUCCESSFUL'
              ? VotingColors.contestLive
              : tx.status === 'FAILED'
              ? Colors.error
              : Colors.onSurfaceVariant;

            return (
              <Pressable
                onPress={() => router.push(`/voting/vote-receipt?transactionId=${tx.id}`)}
                style={({ pressed }) => [styles.txCard, shadow1, pressed && { opacity: 0.88 }]}
              >
                <View style={styles.txLeft}>
                  <View style={[styles.typeBadge, tx.voteType === 'FREE' ? styles.freeBadge : styles.paidBadge]}>
                    <Text style={[styles.typeLabel, tx.voteType === 'FREE' ? { color: VotingColors.freeVote } : { color: Colors.secondary }]}>
                      {tx.voteType}
                    </Text>
                  </View>
                  <View style={styles.txInfo}>
                    <Text style={styles.txName} numberOfLines={1}>{tx.contestantName ?? '—'}</Text>
                    <Text style={styles.txContest} numberOfLines={1}>{tx.contestTitle ?? '—'}</Text>
                    <Text style={styles.txDate}>{formatDate(tx.createdAt)}</Text>
                  </View>
                </View>
                <View style={styles.txRight}>
                  <Text style={styles.txVotes}>+{tx.votes} votes</Text>
                  {tx.amount != null && <Text style={styles.txAmount}>{formatAmount(tx.amount)}</Text>}
                  <Text style={[styles.txStatus, { color: statusColor }]}>{VOTE_STATUS_LABELS[tx.status]}</Text>
                  <ChevronRight size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
                </View>
              </Pressable>
            );
          }}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No votes yet</Text>
              <Text style={styles.emptySub}>Your voting history will appear here once you cast your first vote.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  backBtn:     { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  title:       { ...Typography.titleLg, color: Colors.onSurface },
  summaryCard: { flexDirection: 'row', marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  stat:        { flex: 1, alignItems: 'center', gap: 4 },
  statValue:   { ...Typography.titleLg, color: Colors.onSurface, fontWeight: '700' as const },
  statLabel:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  statDivider: { width: 1, backgroundColor: Colors.surfaceContainerHigh },
  filtersRow:  { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  filterChip:  { paddingVertical: 7, paddingHorizontal: Spacing.md, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, borderWidth: 1, borderColor: Colors.outlineVariant },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterLabel:  { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  filterLabelActive: { color: Colors.onPrimary },
  loader:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:        { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 100 },
  txCard:      { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  txLeft:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  typeBadge:   { paddingVertical: 3, paddingHorizontal: 8, borderRadius: Radius.full },
  freeBadge:   { backgroundColor: VotingColors.freeVoteBg },
  paidBadge:   { backgroundColor: VotingColors.paidVoteBg },
  typeLabel:   { ...Typography.caption, fontWeight: '700' as const },
  txInfo:      { flex: 1, gap: 2 },
  txName:      { ...Typography.labelMd, color: Colors.onSurface },
  txContest:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  txDate:      { ...Typography.caption, color: Colors.outline },
  txRight:     { alignItems: 'flex-end', gap: 2 },
  txVotes:     { ...Typography.labelMd, color: Colors.primary, fontWeight: '700' as const },
  txAmount:    { ...Typography.labelSm, color: Colors.onSurface },
  txStatus:    { ...Typography.caption, fontWeight: '600' as const },
  empty:       { paddingVertical: Spacing.xxl, alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  emptyTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  emptySub:    { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
