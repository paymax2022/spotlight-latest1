import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { TIER_LABELS, TIER_LIMITS } from '@/features/kycverify/constants';
import { kycVerifyDraft, resetKycVerifyDraft, grantKycTier } from '@/features/kycverify/draft';
import { resumeOrFallback } from '@/lib/resume';
import type { KycTier } from '@/features/kycverify/types';

/** K12 — Success. Tier upgraded; shows the new tier + newly unlocked limits. */
export default function KycSuccessScreen() {
  const qc = useQueryClient();
  const newTier = kycVerifyDraft.current.targetTier as KycTier;
  const limits = TIER_LIMITS[newTier];

  // The tier changed — record it locally (so the step-up gate honours it even in
  // dev where the mock verify doesn't raise the profile tier) and refresh the
  // cached KYC profile so K1 and any step-up gate immediately see the new tier.
  useEffect(() => {
    grantKycTier(newTier);
    qc.invalidateQueries({ queryKey: ['kyc', 'me'] });
  }, [qc, newTier]);

  const done = () => {
    // Draft is spent; clear it so K14 resume doesn't re-offer a finished flow.
    resetKycVerifyDraft(newTier);
    kycVerifyDraft.current.sessionId = null;
    // Intelligent routing: return to wherever the user was blocked and continue
    // that action; fall back to home when there's nothing to resume.
    resumeOrFallback('/(tabs)/home');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.center}>
        <View style={styles.ring}><CircleCheck size={64} color={Colors.tertiaryContainer} strokeWidth={1.8} /></View>
        <Text style={styles.title}>You're now {TIER_LABELS[newTier]} 🎉</Text>
        <Text style={styles.sub}>Verification complete. Here's what you've unlocked:</Text>

        <View style={styles.card}>
          <View style={styles.row}><Text style={styles.key}>Daily limit</Text><Text style={styles.val}>{limits.daily}</Text></View>
          <View style={styles.divider} />
          <View style={styles.row}><Text style={styles.key}>Balance</Text><Text style={styles.val}>{limits.balance}</Text></View>
        </View>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Done" onPress={done} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  ring: { width: 120, height: 120, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: {
    alignSelf: 'stretch', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.md, marginTop: Spacing.md,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerHigh },
  key: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  val: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
