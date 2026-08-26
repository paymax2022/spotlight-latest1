import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { TrendingUp, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { formatRate, tierDef } from '@/features/referral/rewards/constants';
import type { ReferralTier } from '@/features/referral/rewards/types';
import { TierBadge } from '@/features/referral/rewards/components';

// PRD §5.1.7 — Tier Upgraded. Separate from the milestone moment — this is about
// the *rate* increasing. Explicit that it applies to FUTURE purchases only (not
// retroactively), to avoid confusion/complaints. Entry via push/param (tier).
export default function TierUpgraded() {
  const params = useLocalSearchParams<{ tier?: string }>();
  const tier = (params.tier as ReferralTier) ?? 'GROWTH';
  const def = tierDef(tier);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Pressable onPress={() => goBack('/referral/rewards')} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
        <X size={22} color={Colors.onPrimary} strokeWidth={2} />
      </Pressable>

      <View style={styles.body}>
        <View style={styles.ring}>
          <View style={styles.inner}><TrendingUp size={52} color={Colors.tertiaryFixed} strokeWidth={1.8} /></View>
        </View>
        <Text style={styles.eyebrow}>Tier upgraded</Text>
        <Text style={styles.headline}>You're now {def.label}</Text>
        <View style={styles.badgeWrap}><TierBadge tier={tier} /></View>
        <Text style={styles.rate}>{formatRate(def.rate)}</Text>
        <Text style={styles.rateLabel}>of the platform margin on every future referral purchase</Text>

        <View style={styles.noteCard}>
          <Text style={styles.noteText}>
            This new rate applies to purchases from now on — it doesn't change rewards you've already earned.
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.cta} onPress={() => router.replace('/referral/rewards')} accessibilityRole="button">
          <Text style={styles.ctaText}>Back to my rewards</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.tertiaryContainer },
  close: { alignSelf: 'flex-end', margin: Spacing.md, width: 40, height: 40, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.sm },
  ring: { width: 132, height: 132, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  inner: { width: 100, height: 100, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  eyebrow: { ...Typography.labelMd, color: Colors.tertiaryFixed, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  headline: { ...Typography.headlineMd, color: Colors.onPrimary, textAlign: 'center', fontWeight: '800' },
  badgeWrap: { marginVertical: Spacing.sm },
  rate: { ...Typography.displayLg, color: Colors.tertiaryFixed, fontWeight: '800' },
  rateLabel: { ...Typography.bodyMd, color: Colors.inverseOnSurface, textAlign: 'center' },
  noteCard: { marginTop: Spacing.lg, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: Radius.lg, padding: Spacing.md },
  noteText: { ...Typography.bodySm, color: Colors.inverseOnSurface, textAlign: 'center', lineHeight: 20 },
  actions: { padding: Spacing.containerMargin },
  cta: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.white, paddingVertical: 15, borderRadius: Radius.full },
  ctaText: { ...Typography.labelLg, color: Colors.tertiaryContainer, fontWeight: '700' },
});
