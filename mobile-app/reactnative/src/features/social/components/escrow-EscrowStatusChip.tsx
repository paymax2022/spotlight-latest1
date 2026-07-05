import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Lock, CheckCircle2, RotateCcw, ShieldAlert } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { SocialColors } from '../constants/social.constants';
import type { EscrowStatus } from '../escrow';

const MAP: Record<EscrowStatus, { label: string; bg: string; fg: string; Icon: typeof Lock }> = {
  HELD:     { label: 'In escrow', bg: SocialColors.warnBg,   fg: SocialColors.warnText, Icon: Lock },
  RELEASED: { label: 'Released',  bg: SocialColors.okBg,     fg: SocialColors.ok,       Icon: CheckCircle2 },
  REFUNDED: { label: 'Refunded',  bg: SocialColors.surfaceAlt, fg: SocialColors.muted,  Icon: RotateCcw },
  DISPUTED: { label: 'Disputed',  bg: SocialColors.dangerBg, fg: SocialColors.danger,   Icon: ShieldAlert },
};

export default function EscrowStatusChip({ status, size = 'md' }: { status: EscrowStatus; size?: 'sm' | 'md' }) {
  const { label, bg, fg, Icon } = MAP[status];
  const iconSize = size === 'sm' ? 12 : 14;
  return (
    <View style={[styles.chip, { backgroundColor: bg }, size === 'sm' && styles.chipSm]}>
      <Icon size={iconSize} color={fg} />
      <Text style={[styles.text, { color: fg }, size === 'sm' && styles.textSm]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.full, alignSelf: 'flex-start' },
  chipSm: { paddingHorizontal: 8, paddingVertical: 3 },
  text: { ...Typography.labelMd },
  textSm: { ...Typography.labelSm },
});
