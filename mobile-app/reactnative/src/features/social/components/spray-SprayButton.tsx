import React from 'react';
import { Pressable, Text, StyleSheet, ViewStyle } from 'react-native';
import { Droplets } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { SocialColors, formatNaira } from '../constants/social.constants';

interface Props {
  amountKobo:  number;
  onPress:     () => void;
  selected?:   boolean;
  disabled?:   boolean;
  style?:      ViewStyle;
}

// A spray denomination chip / button. Reused on the spray sender grid.
export default function SprayButton({ amountKobo, onPress, selected, disabled, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        selected && styles.btnSel,
        disabled && styles.btnDisabled,
        pressed && { opacity: 0.85 },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Spray ${formatNaira(amountKobo)}`}
    >
      <Droplets size={16} color={selected ? '#FFFFFF' : SocialColors.brand} />
      <Text style={[styles.text, selected && styles.textSel]}>{formatNaira(amountKobo)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: SocialColors.brand, borderRadius: Radius.full,
    paddingVertical: 12, paddingHorizontal: 14, backgroundColor: SocialColors.surface,
  },
  btnSel: { backgroundColor: SocialColors.brand, borderColor: SocialColors.brand },
  btnDisabled: { opacity: 0.4 },
  text: { ...Typography.labelLg, color: SocialColors.brand },
  textSel: { color: '#FFFFFF' },
});
