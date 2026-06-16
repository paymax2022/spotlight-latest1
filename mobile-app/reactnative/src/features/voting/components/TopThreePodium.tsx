import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Crown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { VotingColors } from '../constants/voting.constants';
import { formatVoteCount } from '../utils/voteFormatters';
import type { LeaderboardEntry } from '../types/voting.types';

interface Props {
  entries: LeaderboardEntry[];
}

interface PodiumItemProps {
  entry: LeaderboardEntry;
  position: 1 | 2 | 3;
}

function PodiumItem({ entry, position }: PodiumItemProps) {
  const rankColor = position === 1
    ? VotingColors.rankGold
    : position === 2
    ? VotingColors.rankSilver
    : VotingColors.rankBronze;

  const podiumHeight = position === 1 ? 80 : position === 2 ? 60 : 44;
  const avatarSize  = position === 1 ? 72 : 56;

  return (
    <View style={[styles.item, position === 1 && styles.firstPlace]}>
      {position === 1 && (
        <Crown size={20} color={VotingColors.rankGold} fill={VotingColors.rankGold} strokeWidth={0} style={styles.crown} />
      )}
      <View style={[styles.avatarRing, { borderColor: rankColor, width: avatarSize + 6, height: avatarSize + 6, borderRadius: (avatarSize + 6) / 2 }]}>
        {entry.contestant.photo ? (
          <Image
            source={{ uri: entry.contestant.photo }}
            style={[styles.avatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}
          />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}>
            <Text style={styles.avatarInitial}>
              {(entry.contestant.stageName ?? entry.contestant.name).charAt(0)}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.name} numberOfLines={1}>
        {entry.contestant.stageName ?? entry.contestant.name}
      </Text>
      <Text style={[styles.votes, { color: rankColor }]}>
        {formatVoteCount(entry.contestant.votes)}
      </Text>

      <View style={[styles.podiumBlock, { height: podiumHeight, backgroundColor: rankColor + '22', borderTopColor: rankColor }]}>
        <Text style={[styles.rank, { color: rankColor }]}>#{position}</Text>
      </View>
    </View>
  );
}

export default function TopThreePodium({ entries }: Props) {
  const first  = entries.find((e) => e.rank === 1);
  const second = entries.find((e) => e.rank === 2);
  const third  = entries.find((e) => e.rank === 3);

  return (
    <View style={styles.row}>
      {second && <PodiumItem entry={second} position={2} />}
      {first  && <PodiumItem entry={first}  position={1} />}
      {third  && <PodiumItem entry={third}  position={3} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: Spacing.sm },
  item:    { alignItems: 'center', flex: 1, maxWidth: 120 },
  firstPlace: { marginBottom: Spacing.sm },
  crown:   { marginBottom: 4 },
  avatarRing: { borderWidth: 2.5, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  avatar:  {},
  avatarPlaceholder: { backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { ...Typography.titleMd, color: Colors.onPrimaryContainer },
  name:    { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center', marginBottom: 2, fontWeight: '600' as const },
  votes:   { ...Typography.caption, fontWeight: '700' as const, marginBottom: 4 },
  podiumBlock: {
    width:           '100%',
    borderTopWidth:  2,
    alignItems:      'center',
    justifyContent:  'center',
    borderTopLeftRadius:  Radius.sm,
    borderTopRightRadius: Radius.sm,
  },
  rank: { ...Typography.labelSm, fontWeight: '700' as const },
});
