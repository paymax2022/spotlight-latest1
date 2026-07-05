import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { RISK_DISCLOSURE_RIBBON } from '../constants';

/** Mandatory persistent SEC-style risk-disclosure ribbon. Surfaced on home,
 *  marketplace and subscription screens. */
export default function RiskRibbon({ text, compact }: { text?: string; compact?: boolean }) {
  return (
    <View style={[styles.ribbon, compact && styles.compact]}>
      <Info size={14} color={Colors.onWarning} strokeWidth={2} />
      <Text style={styles.text} numberOfLines={compact ? 2 : undefined}>
        {text ?? RISK_DISCLOSURE_RIBBON}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ribbon: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    backgroundColor: Colors.iconBgGold, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: 'rgba(234,179,8,0.35)',
  },
  compact: { paddingVertical: 8 },
  text: { ...Typography.labelSm, color: Colors.onWarning, flex: 1, lineHeight: 16 },
});
