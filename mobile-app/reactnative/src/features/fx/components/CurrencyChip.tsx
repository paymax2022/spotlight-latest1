import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { CURRENCIES } from '../constants/fx.constants';
import type { CurrencyCode } from '../types/fx.types';

interface Props {
  currency: CurrencyCode;
  onPress?: () => void;
  compact?: boolean;
}

/** Flag + code pill used as the currency selector trigger across convert/send. */
export default function CurrencyChip({ currency, onPress, compact }: Props) {
  const meta = CURRENCIES[currency];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`Currency ${meta.name}`}
      style={({ pressed }) => [styles.chip, compact && styles.compact, pressed && styles.pressed]}
    >
      <Text style={styles.flag}>{meta.flag}</Text>
      <Text style={styles.code}>{meta.code}</Text>
      {onPress ? <ChevronDown size={16} color={Colors.onSurfaceVariant} strokeWidth={2} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  compact: { paddingVertical: 5 },
  pressed: { opacity: 0.8 },
  flag: { fontSize: 18 },
  code: { ...Typography.labelLg, color: Colors.onSurface },
});
