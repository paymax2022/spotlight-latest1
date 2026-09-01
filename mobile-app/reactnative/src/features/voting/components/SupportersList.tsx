import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { VotingColors } from '@/features/voting/constants/voting.constants';
import { formatDate } from '@/features/voting/utils/voteFormatters';
import { useContestantSupporters } from '@/features/voting/hooks/useContestantSupporters';

/**
 * "Who voted for you" — the contestant's own supporters.
 *
 * SAFE TO PLACE ON A PUBLIC SCREEN. The list is contestant-private and the
 * SERVER is the gate: it answers 403 to anyone who does not own the contestant,
 * so for every other viewer this renders nothing at all. That is why the same
 * component can sit on the private dashboard and the public profile without the
 * two screens needing different rules — the absence of the section IS the
 * authorisation result, not a decision made here.
 *
 * A vote cast under the contest's allow_anonymous_free_vote setting arrives with
 * no name — the server blanks it rather than trusting this component to hide an
 * identity it was sent.
 */
export default function SupportersList({
  contestantId,
  max = 25,
}: {
  contestantId?: string;
  max?: number;
}) {
  const supporters = useContestantSupporters(contestantId);
  const rows = supporters.data ?? [];
  if (rows.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Who voted for you ({rows.length})</Text>
      {rows.slice(0, max).map((s, i) => (
        <View key={`${s.createdAt}-${i}`} style={[styles.row, i > 0 && styles.divider]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, s.anonymous && styles.anon]} numberOfLines={1}>
              {s.anonymous ? 'Anonymous voter' : s.voterName}
            </Text>
            <Text style={styles.meta}>{formatDate(s.createdAt)}</Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.votes}>+{s.quantity}</Text>
            <Text style={[styles.type, s.paid ? { color: Colors.secondary } : { color: VotingColors.freeVote }]}>
              {s.paid ? 'Paid' : 'Free'}
            </Text>
          </View>
        </View>
      ))}
      {rows.length > max ? (
        <Text style={styles.more}>Showing the {max} most recent of {rows.length}.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.md, marginBottom: Spacing.md, gap: 2,
  },
  title: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  divider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  name: { ...Typography.labelMd, color: Colors.onSurface },
  anon: { color: Colors.onSurfaceVariant, fontStyle: 'italic' as const },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  right: { alignItems: 'flex-end' },
  votes: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
  type: { ...Typography.labelSm },
  more: { ...Typography.labelSm, color: Colors.onSurfaceVariant, paddingTop: Spacing.xs },
});
