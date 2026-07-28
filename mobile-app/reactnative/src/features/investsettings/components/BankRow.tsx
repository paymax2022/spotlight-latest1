import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Landmark, Trash2, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { LinkedBank } from '../types/settings.types';

interface Props {
  bank: LinkedBank;
  onRemove: () => void;
  removing?: boolean;
}

export default function BankRow({ bank, onRemove, removing }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.iconBox}>
        <Landmark size={20} color={Colors.secondary} strokeWidth={1.8} />
      </View>
      <View style={styles.flex}>
        <View style={styles.titleRow}>
          <Text style={styles.bank} numberOfLines={1}>{bank.bankName}</Text>
          {bank.primary && (
            <View style={styles.primaryChip}>
              <Star size={11} color={Colors.onWarning} strokeWidth={2} fill={Colors.gold} />
              <Text style={styles.primaryText}>Primary</Text>
            </View>
          )}
        </View>
        <Text style={styles.account}>{bank.accountMasked}</Text>
      </View>
      <Pressable
        onPress={onRemove}
        disabled={removing}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${bank.bankName}`}
        style={removing && styles.disabled}
      >
        <Trash2 size={18} color={Colors.error} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  iconBox: {
    width: 40, height: 40, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.iconBgBlue,
  },
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bank: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  account: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  primaryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.iconBgGold, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
  },
  primaryText: { ...Typography.caption, color: Colors.onWarning, fontWeight: '600' as const },
  disabled: { opacity: 0.5 },
});
