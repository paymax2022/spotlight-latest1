import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ShieldAlert, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import {
  InsuranceColors,
  TIER_LABEL,
  TIER_REQUIREMENT,
  TIER_RANK,
} from '@/features/insurance/constants/insurance.constants';
import type { KycTier } from '@/features/insurance/types';

export default function KycGap() {
  const { required, current } = useLocalSearchParams<{ required?: string; current?: string; code?: string }>();
  const requiredTier = (required as KycTier) ?? 'TIER_2';
  const currentTier = (current as KycTier) ?? 'TIER_0';

  // Steps from current+1 up to required (what the user still needs).
  const steps = (Object.keys(TIER_RANK) as KycTier[])
    .filter((t) => TIER_RANK[t] > TIER_RANK[currentTier] && TIER_RANK[t] <= TIER_RANK[requiredTier]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Verification needed" />

      <View style={styles.body}>
        <View style={styles.iconBox}><ShieldAlert size={30} color={InsuranceColors.warnText} strokeWidth={2} /></View>
        <Text style={styles.title}>Upgrade to {TIER_LABEL[requiredTier]}</Text>
        <Text style={styles.subtitle}>
          This product requires {TIER_LABEL[requiredTier]} verification. You're currently{' '}
          {TIER_LABEL[currentTier]}. Complete the steps below to continue.
        </Text>

        <View style={styles.card}>
          {steps.map((t) => (
            <View key={t} style={styles.stepRow}>
              <View style={styles.stepIcon}><Check size={14} color={InsuranceColors.ok} strokeWidth={2.6} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTier}>{TIER_LABEL[t]}</Text>
                <Text style={styles.stepReq}>{TIER_REQUIREMENT[t]}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Go to verification" onPress={() => router.push('/(tabs)/wallet')} />
        <PrimaryButton label="Not now" variant="ghost" onPress={() => goBack('/insurance')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1, paddingHorizontal: Spacing.containerMargin, alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.lg },
  iconBox: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { width: '100%', backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.md, gap: Spacing.sm, marginTop: Spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  stepIcon: { width: 28, height: 28, borderRadius: Radius.full, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center' },
  stepTier: { ...Typography.labelLg, color: Colors.onSurface },
  stepReq: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  footer: { padding: Spacing.containerMargin, gap: Spacing.xs },
});
