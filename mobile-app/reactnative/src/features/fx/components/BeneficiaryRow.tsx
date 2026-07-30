import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Star, ChevronRight, BadgeCheck, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { CURRENCIES, RAIL_LABEL } from '../constants/fx.constants';
import { maskAccount } from '../utils/fxFormatters';
import type { Beneficiary } from '../types/fx.types';

interface Props {
  beneficiary: Beneficiary;
  onPress?: () => void;
  onToggleFavorite?: () => void;
  showChevron?: boolean;
}

/** Beneficiary list row (spec G / D → select beneficiary). */
export default function BeneficiaryRow({ beneficiary, onPress, onToggleFavorite, showChevron }: Props) {
  const meta = CURRENCIES[beneficiary.currency];
  const initials = beneficiary.name.split(' ').slice(0, 2).map((s) => s[0]).join('').toUpperCase();

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${beneficiary.name}, ${RAIL_LABEL[beneficiary.rail]}, ${maskAccount(beneficiary.accountNumber)}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.avatar}>
        <Text style={styles.initials}>{initials}</Text>
      </View>

      <View style={styles.mid}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{beneficiary.name}</Text>
          {beneficiary.validated
            ? <BadgeCheck size={14} color={Colors.teal} strokeWidth={2} />
            : <ShieldAlert size={14} color={Colors.error} strokeWidth={2} />}
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {meta.flag} {beneficiary.bankName ?? RAIL_LABEL[beneficiary.rail]} · {maskAccount(beneficiary.accountNumber)}
        </Text>
      </View>

      {onToggleFavorite ? (
        <Pressable onPress={onToggleFavorite} hitSlop={10} accessibilityRole="button" accessibilityLabel={beneficiary.favorite ? 'Unfavorite' : 'Favorite'}>
          <Star
            size={18}
            color={beneficiary.favorite ? Colors.gold : Colors.outline}
            fill={beneficiary.favorite ? Colors.gold : 'transparent'}
            strokeWidth={2}
          />
        </Pressable>
      ) : null}
      {showChevron ? <ChevronRight size={18} color={Colors.outline} strokeWidth={2} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  pressed: { opacity: 0.7 },
  avatar: {
    width: 42, height: 42, borderRadius: Radius.full,
    backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center',
  },
  initials: { ...Typography.labelMd, color: Colors.primary },
  mid: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
});
