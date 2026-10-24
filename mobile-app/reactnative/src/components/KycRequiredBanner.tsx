// "Verify your identity" prompt. Shown on the wallet when the balance API refused the
// read for KYC reasons (see kycGate.ts). The balance itself is still shown; this explains
// why money actions need verification and takes the user straight to it.

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { router } from 'expo-router';
import { ShieldAlert, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';

type Props = {
  /** The KYC tier the server demanded (1 = basic identity). */
  requiredTier: number;
};

export default function KycRequiredBanner({ requiredTier }: Props) {
  const go = () =>
    router.push({ pathname: '/kyc-verify', params: { target: String(requiredTier) } } as never);

  return (
    <Pressable
      onPress={go}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
      accessibilityRole="button"
      accessibilityLabel="Verify your identity to add money, send and withdraw"
    >
      <View style={styles.icon}>
        <ShieldAlert size={20} color={Colors.onWarning} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>Verify your identity</Text>
        <Text style={styles.sub}>
          Complete a quick check to add money, send and withdraw. Your balance is safe and shown above.
        </Text>
      </View>
      <View style={styles.cta}>
        <Text style={styles.ctaText}>Verify</Text>
        <ChevronRight size={16} color={Colors.onPrimary} strokeWidth={2.2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
             marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
             padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.iconBgGold,
             borderWidth: 1, borderColor: Colors.gold },
  icon:    { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center',
             backgroundColor: Colors.surface },
  body:    { flex: 1, gap: 2 },
  title:   { ...Typography.labelLg, color: Colors.onSurface },
  sub:     { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  cta:     { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: Spacing.md,
             paddingVertical: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.primary },
  ctaText: { ...Typography.labelMd, color: Colors.onPrimary },
});
