// ── Marketplace — SafetyStrip ────────────────────────────────────────────────
// The persistent "meet safely, Paymax doesn't hold funds" reassurance strip.
// Uses the shared CONNECT_SAFETY_STRIP copy so it reads identically everywhere.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors, CONNECT_SAFETY_STRIP } from '@/features/marketplace';

export default function SafetyStrip({ text }: { text?: string }) {
  return (
    <View style={styles.wrap}>
      <ShieldCheck size={15} color={MarketColors.ok} />
      <Text style={styles.text}>{text ?? CONNECT_SAFETY_STRIP}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: MarketColors.okBg,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.sm,
  },
  text: { ...Typography.labelSm, color: MarketColors.text, flex: 1, lineHeight: 16 },
});
