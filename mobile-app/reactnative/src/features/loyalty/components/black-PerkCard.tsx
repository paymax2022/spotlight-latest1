import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import { LoyaltyColors } from '../constants/loyalty.constants';
import type { BlackPerk } from '../black';

interface Props {
  perk:     BlackPerk;
  onRedeem?: () => void;
}

export default function BlackPerkCard({ perk, onRedeem }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.emoji}>{perk.emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{perk.title}</Text>
        <Text style={styles.desc}>{perk.description}</Text>
      </View>
      {perk.redeemable ? (
        <Pressable onPress={onRedeem} style={({ pressed }) => [styles.redeemBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`Redeem ${perk.title}`}>
          <Text style={styles.redeemText}>Redeem</Text>
          <ChevronRight size={14} color={LoyaltyColors.brandText} />
        </Pressable>
      ) : (
        <View style={styles.activeChip}><Text style={styles.activeText}>Active</Text></View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: LoyaltyColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, ...shadow1,
  },
  emoji: { fontSize: 28 },
  title: { ...Typography.titleMd, color: LoyaltyColors.text },
  desc: { ...Typography.bodySm, color: LoyaltyColors.muted, marginTop: 2 },
  redeemBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: LoyaltyColors.brandBg, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full },
  redeemText: { ...Typography.labelMd, color: LoyaltyColors.brandText },
  activeChip: { backgroundColor: LoyaltyColors.okBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.full },
  activeText: { ...Typography.labelSm, color: LoyaltyColors.ok },
});
