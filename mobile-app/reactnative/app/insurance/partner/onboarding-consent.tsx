import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, Check, CircleCheck } from 'lucide-react-native';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useOnboardingConsent, useAcceptOnboardingConsent } from '@/features/insurance/partner';
import { UnderwriterBadge, PremiumRow } from '@/features/insurance/components';
import { InsuranceColors } from '@/features/insurance/constants/insurance.constants';

/** Partner/driver: onboarding cover consent (PRD §15.3 / §18 NDPA). */
export default function PartnerOnboardingConsent() {
  const consent = useOnboardingConsent();
  const accept = useAcceptOnboardingConsent();
  const idemKey = useRef(`ins-onboard-${Math.random().toString(36).slice(2, 10)}`).current;
  const [agreed, setAgreed] = useState(false);

  if (consent.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Onboarding cover" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (consent.isError || !consent.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Onboarding cover" />
        <StateView kind="error" title="Couldn't load consent" actionLabel="Retry" onAction={() => consent.refetch()} />
      </SafeAreaView>
    );
  }

  const c = consent.data;

  if (c.accepted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Onboarding cover" showBack={false} />
        <View style={styles.successWrap}>
          <View style={styles.heroIcon}><CircleCheck size={40} color={InsuranceColors.ok} strokeWidth={2} /></View>
          <Text style={styles.successTitle}>Cover activated</Text>
          <Text style={styles.successSub}>{c.productName} is now active. You're protected on every job.</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="View my cover" onPress={() => router.replace('/insurance/partner/my-policies')} />
        </View>
      </SafeAreaView>
    );
  }

  const onAccept = async () => {
    await accept.mutateAsync(idemKey);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Onboarding cover" subtitle="Driver protection" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIconSm}><ShieldCheck size={26} color={InsuranceColors.octamile} strokeWidth={2} /></View>
          <Text style={styles.heroTitle}>{c.productName}</Text>
          <Text style={styles.heroSub}>Activate protection as part of your driver onboarding.</Text>
        </View>

        <UnderwriterBadge disclosure={c.disclosure} />

        <View style={styles.card}>
          {c.benefits.map((b) => (
            <View key={b} style={styles.benefit}>
              <Check size={16} color={InsuranceColors.ok} />
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <PremiumRow label="Cover (sum insured)" amountKobo={c.sumInsuredKobo} />
          <PremiumRow label="Premium" amountKobo={c.premiumKobo} cadence={c.premiumCadence} emphasis />
        </View>

        <Text style={styles.section}>Data you're sharing (NDPA 2023)</Text>
        <View style={styles.card}>
          {c.fields.map((f) => (
            <View key={f} style={styles.fieldRow}>
              <Check size={14} color={InsuranceColors.muted} />
              <Text style={styles.fieldText}>{f}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.note}>Only the fields above are shared with the underwriter, with your consent. Premium is debited from your wallet and passed through to the underwriter.</Text>

        <Pressable style={styles.consentRow} onPress={() => setAgreed((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
          <View style={[styles.checkbox, agreed && styles.checkboxOn]}>{agreed ? <Check size={14} color={Colors.background} strokeWidth={3} /> : null}</View>
          <Text style={styles.consentText}>I consent to sharing the data above with the underwriter and agree to the cover terms.</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Activate cover" onPress={onAccept} disabled={!agreed} loading={accept.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md },
  hero: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md },
  heroIconSm: { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: InsuranceColors.octamileBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.md, gap: Spacing.sm },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  benefitText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  section: { ...Typography.titleMd, color: Colors.onSurface },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  fieldText: { ...Typography.bodyMd, color: Colors.onSurface },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.xs },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: InsuranceColors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: InsuranceColors.ok, borderColor: InsuranceColors.ok },
  consentText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 20 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  heroIcon: { width: 72, height: 72, borderRadius: Radius.xl, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center' },
  successTitle: { ...Typography.titleLg, color: Colors.onSurface },
  successSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
