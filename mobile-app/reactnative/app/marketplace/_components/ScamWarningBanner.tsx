// ── Marketplace — ScamWarningBanner (Screen 19 Deal Room) ────────────────────
// Fires when a message (typed or received) matches an off-platform / scam
// pattern. Shows a plain-language warning naming the risky behaviour, and — once
// it has been shown at least once — reveals a "continue safely" bridge the
// parent controls (so a seller can still choose to move off-app knowingly).
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors } from '@/features/marketplace';

export default function ScamWarningBanner({
  hint,
  showBridge,
  onContinueSafely,
}: {
  hint: string;
  showBridge?: boolean;
  onContinueSafely?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <AlertTriangle size={18} color={MarketColors.danger} />
        <Text style={styles.title}>Careful — this looks risky</Text>
      </View>
      <Text style={styles.body}>
        We noticed talk of {hint}. Payments made outside Paymax escrow are not protected — if something goes wrong, we
        cannot refund you. Keep the deal in-app so your money stays covered.
      </Text>
      {showBridge && onContinueSafely ? (
        <Pressable onPress={onContinueSafely} style={styles.bridge} accessibilityRole="button">
          <Text style={styles.bridgeText}>I understand the risk — continue anyway</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: MarketColors.dangerBg,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: MarketColors.danger,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  title: { ...Typography.labelLg, color: MarketColors.danger, fontWeight: '800' },
  body: { ...Typography.bodySm, color: MarketColors.text, lineHeight: 19 },
  bridge: { marginTop: Spacing.xs, alignSelf: 'flex-start' },
  bridgeText: { ...Typography.labelMd, color: MarketColors.danger, fontWeight: '700', textDecorationLine: 'underline' },
});
