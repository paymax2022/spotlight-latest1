import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check, Star } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { CreatorsColors, formatNaira } from '../constants/creators.constants';
import type { SubTier } from '../types';

interface Props {
  tier:      SubTier;
  selected?: boolean;
  onPress?:  () => void;
}

export default function CreatorSubTierCard({ tier, selected, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, selected && styles.cardSel, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.head}>
        <View style={styles.titleWrap}>
          <Text style={[styles.name, selected && styles.nameSel]}>{tier.name}</Text>
          {tier.popular ? (
            <View style={styles.popular}><Star size={11} color={CreatorsColors.warnText} /><Text style={styles.popularText}>Popular</Text></View>
          ) : null}
        </View>
        <View style={[styles.radio, selected && styles.radioSel]}>
          {selected ? <Check size={14} color="#FFFFFF" /> : null}
        </View>
      </View>

      <Text style={[styles.price, selected && styles.priceSel]}>
        {formatNaira(tier.priceKobo)}<Text style={styles.per}>/month</Text>
      </Text>

      <View style={styles.perks}>
        {tier.perks.map((p) => (
          <View key={p} style={styles.perkRow}>
            <Check size={14} color={CreatorsColors.ok} />
            <Text style={styles.perkText}>{p}</Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5, borderColor: CreatorsColors.border, borderRadius: Radius.lg,
    padding: Spacing.cardPadding, gap: Spacing.sm, backgroundColor: CreatorsColors.surface,
  },
  cardSel: { borderColor: CreatorsColors.brand, backgroundColor: CreatorsColors.brandBg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { ...Typography.titleMd, color: CreatorsColors.text },
  nameSel: { color: CreatorsColors.brand },
  popular: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: CreatorsColors.warnBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  popularText: { ...Typography.labelSm, color: CreatorsColors.warnText },
  radio: { width: 24, height: 24, borderRadius: Radius.full, borderWidth: 2, borderColor: CreatorsColors.border, alignItems: 'center', justifyContent: 'center' },
  radioSel: { backgroundColor: CreatorsColors.brand, borderColor: CreatorsColors.brand },
  price: { ...Typography.headlineMd, color: CreatorsColors.text },
  priceSel: { color: CreatorsColors.brand },
  per: { ...Typography.bodySm, color: CreatorsColors.muted },
  perks: { gap: 6, marginTop: 2 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  perkText: { ...Typography.bodySm, color: CreatorsColors.text, flex: 1 },
});
