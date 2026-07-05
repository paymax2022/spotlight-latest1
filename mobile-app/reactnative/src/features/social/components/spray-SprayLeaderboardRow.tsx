import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { SocialColors, formatNaira } from '../constants/social.constants';
import type { SprayLeaderEntry } from '../spray';

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function SprayLeaderboardRow({ entry }: { entry: SprayLeaderEntry }) {
  const initials = entry.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={[styles.row, entry.isYou && styles.rowYou]}>
      <Text style={styles.rank}>{MEDAL[entry.rank] ?? entry.rank}</Text>
      <View style={[styles.avatar, { backgroundColor: entry.avatarColor }]}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{entry.name}{entry.isYou ? ' (You)' : ''}</Text>
        <Text style={styles.handle} numberOfLines={1}>{entry.handle}</Text>
      </View>
      <Text style={styles.total}>{formatNaira(entry.totalKobo)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 10 },
  rowYou: { backgroundColor: SocialColors.surfaceAlt, borderRadius: Radius.md, paddingHorizontal: Spacing.sm },
  rank: { ...Typography.titleMd, color: SocialColors.text, width: 30, textAlign: 'center' },
  avatar: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.labelMd, color: '#FFFFFF' },
  name: { ...Typography.labelLg, color: SocialColors.text },
  handle: { ...Typography.labelSm, color: SocialColors.muted },
  total: { ...Typography.titleMd, color: SocialColors.brand },
});
