import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Zap, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1, shadow2 } from '@/constants/shadows';
import { VotingColors } from '../constants/voting.constants';
import { formatAmount } from '../utils/voteFormatters';
import type { VotePackage } from '../types/voting.types';

interface Props {
  pkg: VotePackage;
  selected?: boolean;
  onPress: () => void;
}

export default function VotePackageCard({ pkg, selected, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected ? [styles.selected, shadow2] : shadow1,
        pressed && styles.pressed,
      ]}
    >
      {pkg.isPopular && (
        <View style={[styles.topBadge, { backgroundColor: Colors.secondary }]}>
          <Zap size={10} color={Colors.onSecondary} fill={Colors.onSecondary} strokeWidth={0} />
          <Text style={styles.topBadgeText}>Most Popular</Text>
        </View>
      )}
      {pkg.isBestValue && (
        <View style={[styles.topBadge, { backgroundColor: VotingColors.rankGold }]}>
          <Star size={10} color="#fff" fill="#fff" strokeWidth={0} />
          <Text style={styles.topBadgeText}>Best Value</Text>
        </View>
      )}

      <View style={styles.body}>
        <Text style={[styles.votes, selected && { color: Colors.primary }]}>
          {pkg.votes + (pkg.bonusVotes ?? 0)}
          <Text style={styles.votesSub}> votes</Text>
        </Text>
        {pkg.bonusVotes ? (
          <View style={styles.bonusRow}>
            <Text style={styles.baseVotes}>{pkg.votes} +</Text>
            <Text style={styles.bonus}> {pkg.bonusVotes} bonus</Text>
          </View>
        ) : null}
        {pkg.label && <Text style={styles.label}>{pkg.label}</Text>}
      </View>

      <View style={[styles.priceBox, selected && styles.priceBoxSelected]}>
        <Text style={[styles.price, selected && { color: Colors.onPrimary }]}>
          {formatAmount(pkg.amount)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius:    Radius.xl,
    borderWidth:     1.5,
    borderColor:     Colors.surfaceContainerHigh,
    padding:         Spacing.md,
    overflow:        'hidden',
  },
  selected: {
    borderColor:     Colors.primary,
    backgroundColor: Colors.surfaceContainerLow,
  },
  pressed:  { opacity: 0.88 },
  topBadge: {
    position:        'absolute',
    top:             0,
    right:           0,
    flexDirection:   'row',
    alignItems:      'center',
    gap:             3,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderBottomLeftRadius: Radius.lg,
  },
  topBadgeText: { ...Typography.caption, color: Colors.onPrimary, fontWeight: '700' as const },
  body:         { gap: 2, marginTop: 8 },
  votes:        { ...Typography.headlineMd, color: Colors.onSurface, lineHeight: 30 },
  votesSub:     { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  bonusRow:     { flexDirection: 'row', alignItems: 'center' },
  baseVotes:    { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  bonus:        { ...Typography.labelSm, color: VotingColors.contestLive, fontWeight: '600' as const },
  label:        { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
  priceBox: {
    marginTop:       Spacing.sm,
    backgroundColor: Colors.surfaceContainerHigh,
    borderRadius:    Radius.md,
    paddingVertical: 8,
    alignItems:      'center',
  },
  priceBoxSelected: { backgroundColor: Colors.primary },
  price:            { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
});
