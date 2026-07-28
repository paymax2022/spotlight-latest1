import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, ListChecks } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { TIER_LABELS, TIER_REQUIREMENT_COPY, TIER_LIMITS } from '@/features/kycverify/constants';
import { kycVerifyDraft } from '@/features/kycverify/draft';
import type { KycTier } from '@/features/kycverify/types';

/**
 * K2 — Tier requirements. Sets expectations by deriving the checklist from the
 * target tier: only what THIS tier needs (UX rule: never over-collect).
 */
export default function KycRequirementsScreen() {
  const params = useLocalSearchParams<{ target?: string }>();
  const target = (Number(params.target ?? kycVerifyDraft.current.targetTier) || 1) as Exclude<KycTier, 0>;
  const items = TIER_REQUIREMENT_COPY[target] ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Reach ${TIER_LABELS[target]}`} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><ListChecks size={28} color={Colors.primary} strokeWidth={2} /></View>
          <Text style={styles.heroTitle}>To reach {TIER_LABELS[target]}, you'll need:</Text>
          <Text style={styles.heroSub}>
            It takes about 3 minutes. Your progress is saved as you go, so you can pause and resume any time.
          </Text>
        </View>

        <View style={styles.card}>
          {items.map((item, i) => (
            <View key={i} style={styles.row}>
              <View style={styles.check}><Check size={14} color={Colors.teal} strokeWidth={3} /></View>
              <Text style={styles.rowText}>{item}</Text>
            </View>
          ))}
        </View>

        <View style={styles.unlockBox}>
          <Text style={styles.unlockTitle}>What you'll unlock</Text>
          <Text style={styles.unlockText}>
            Daily limit {TIER_LIMITS[target].daily} · {TIER_LIMITS[target].balance}
          </Text>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton
          label="Continue"
          onPress={() => router.push({ pathname: '/kyc-verify/consent', params: { target: String(target) } })}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  heroIcon: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.xs,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  check: { width: 24, height: 24, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  rowText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  unlockBox: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, gap: 2 },
  unlockTitle: { ...Typography.labelMd, color: Colors.onSurface },
  unlockText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
