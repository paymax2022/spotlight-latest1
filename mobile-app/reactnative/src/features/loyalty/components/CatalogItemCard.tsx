import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { LoyaltyColors, formatPoints } from '../constants/loyalty.constants';
import type { CatalogItem } from '../types';

interface Props {
  item: CatalogItem;
  balancePoints: number;
  locked?: boolean;          // below required tier
  onPress: () => void;
}

const KIND_LABEL: Record<CatalogItem['kind'], string> = {
  airtime: 'Airtime', bill: 'Bill credit', discount: 'Discount', perk: 'Perk',
};

export default function CatalogItemCard({ item, balancePoints, locked, onPress }: Props) {
  const affordable = balancePoints >= item.costPoints && !locked;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }, !affordable && styles.dim]}>
      <View style={styles.iconBox}><Text style={styles.emoji}>{item.emoji}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
        <View style={styles.kindChip}><Text style={styles.kindText}>{KIND_LABEL[item.kind]}</Text></View>
      </View>
      <View style={styles.right}>
        <Text style={styles.cost}>{formatPoints(item.costPoints)}</Text>
        {locked ? <Text style={styles.locked}>Tier locked</Text>
          : !affordable ? <Text style={styles.short}>Need more</Text>
          : <Text style={styles.go}>Redeem</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: LoyaltyColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  dim: { opacity: 0.6 },
  iconBox: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: LoyaltyColors.brandBg, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 26 },
  title: { ...Typography.titleMd, color: LoyaltyColors.text },
  desc: { ...Typography.bodySm, color: LoyaltyColors.muted, marginTop: 2 },
  kindChip: { alignSelf: 'flex-start', backgroundColor: LoyaltyColors.surfaceAlt, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full, marginTop: 6 },
  kindText: { ...Typography.caption, color: LoyaltyColors.muted },
  right: { alignItems: 'flex-end', gap: 2 },
  cost: { ...Typography.labelLg, color: LoyaltyColors.brandText },
  go: { ...Typography.caption, color: LoyaltyColors.ok },
  short: { ...Typography.caption, color: LoyaltyColors.muted },
  locked: { ...Typography.caption, color: LoyaltyColors.muted },
});
