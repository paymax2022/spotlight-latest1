import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { usePolicy } from '@/features/insurance/hooks';
import { UnderwriterBadge, PremiumRow } from '@/features/insurance/components';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';

export default function PaySuccess() {
  const { policyId } = useLocalSearchParams<{ policyId: string }>();
  const policy = usePolicy(policyId ?? '');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.iconBox}><CircleCheck size={40} color={InsuranceColors.ok} strokeWidth={2} /></View>
        <Text style={styles.title}>You're covered!</Text>
        <Text style={styles.subtitle}>Your policy is active and your certificate is in your policy wallet.</Text>

        {policy.isLoading ? (
          <StateView kind="loading" compact message="Loading your policy…" />
        ) : policy.data ? (
          <View style={styles.card}>
            <PremiumRow label="Policy" value={policy.data.productName} />
            <PremiumRow label="Cover" amountKobo={policy.data.sumInsuredKobo} />
            <PremiumRow label="Premium" amountKobo={policy.data.premiumKobo} cadence={policy.data.premiumCadence} />
            <View style={styles.discWrap}>
              <UnderwriterBadge disclosure={policy.data.disclosure} compact />
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        {policy.data?.certificateRef ? (
          <PrimaryButton
            label="View certificate"
            onPress={() => router.replace(`/insurance/policies/${policyId}/certificate`)}
          />
        ) : null}
        <PrimaryButton label="Go to my policies" variant="secondary" onPress={() => router.replace('/insurance/policies')} />
        <PrimaryButton label="Done" variant="ghost" onPress={() => router.replace('/insurance')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1, paddingHorizontal: Spacing.containerMargin, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  iconBox: { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { width: '100%', backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, marginTop: Spacing.sm },
  discWrap: { paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: InsuranceColors.border, marginTop: Spacing.xs },
  footer: { padding: Spacing.containerMargin, gap: Spacing.sm },
});
