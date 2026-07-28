import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { UserRound } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { formatNaira, relativeTime, maskAnonymous } from '../utils/crowdfundingFormatters';
import type { Contributor } from '../types/crowdfunding.types';

interface Props {
  contributor: Contributor;
  rank?: number;          // optional leaderboard position
}

export default function ContributorRow({ contributor, rank }: Props) {
  const name = maskAnonymous(contributor.displayName, contributor.anonymous);
  const showAvatar = !contributor.anonymous && contributor.avatarUrl;

  return (
    <View style={styles.row}>
      {rank != null && <Text style={styles.rank}>{rank}</Text>}

      <View style={styles.avatar}>
        {showAvatar ? (
          <Image source={{ uri: contributor.avatarUrl! }} style={styles.avatarImg} />
        ) : (
          <UserRound size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.amount}>{formatNaira(contributor.amountKobo)}</Text>
        </View>
        {contributor.message ? (
          <Text style={styles.message} numberOfLines={2}>{contributor.message}</Text>
        ) : null}
        <Text style={styles.time}>{relativeTime(contributor.createdAt)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: Spacing.sm },
  rank: { ...Typography.labelMd, color: Colors.onSurfaceVariant, width: 18, textAlign: 'center', marginTop: 10 },
  avatar: {
    width: 40, height: 40, borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerHigh,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  body: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  name: { ...Typography.labelMd, color: Colors.onSurface, flexShrink: 1 },
  amount: { ...Typography.labelMd, color: Colors.teal },
  message: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  time: { ...Typography.caption, color: Colors.outline },
});
