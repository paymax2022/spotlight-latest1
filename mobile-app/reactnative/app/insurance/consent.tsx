import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Lock, Check, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useQuote, useRecordConsent } from '@/features/insurance/hooks';
import { InsuranceColors, CONSENT_VERSION } from '@/features/insurance/constants/insurance.constants';

export default function ConsentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const quote = useQuote(id ?? '');
  const recordConsent = useRecordConsent();
  const [accepted, setAccepted] = useState(false);

  if (quote.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Data consent" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (quote.isError || !quote.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Data consent" />
        <StateView kind="error" title="Quote unavailable" actionLabel="Start over" onAction={() => router.replace('/insurance/browse')} />
      </SafeAreaView>
    );
  }

  const q = quote.data;
  // Data minimisation (PRD §18): only the fields this product's quote required.
  const sharedFields = Object.keys(q.inputs);

  const onAccept = async () => {
    await recordConsent.mutateAsync({
      productCode: q.productCode,
      version: CONSENT_VERSION,
      fields: sharedFields,
      acceptedAt: new Date().toISOString(),
    });
    router.push(`/insurance/pay/summary?id=${q.id}`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Data consent" subtitle="NDPA 2023" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.iconBox}><Lock size={26} color={InsuranceColors.brand} strokeWidth={2} /></View>
        <Text style={styles.title}>Share your data with {q.disclosure.aggregator}</Text>
        <Text style={styles.subtitle}>
          To bind this policy with {q.disclosure.underwriter}, we'll share only the data this product
          needs. We never share more than required (data minimisation).
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Data shared for this product</Text>
          {sharedFields.map((f) => (
            <View key={f} style={styles.fieldRow}>
              <Check size={14} color={InsuranceColors.ok} strokeWidth={2.6} />
              <Text style={styles.fieldText}>{humanize(f)}</Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.consentRow} onPress={() => setAccepted((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }}>
          <View style={[styles.checkbox, accepted && styles.checkboxOn]}>
            {accepted ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
          </View>
          <Text style={styles.consentText}>
            I consent to Paymax sharing the data listed above with {q.disclosure.aggregator} and{' '}
            {q.disclosure.underwriter} to provide this cover, under NDPA 2023. Consent version {CONSENT_VERSION}.
          </Text>
        </Pressable>

        <View style={styles.policyLink}>
          <FileText size={16} color={Colors.onSurfaceVariant} />
          <Text style={styles.policyLinkText}>Your consent is versioned and logged. You can withdraw it from Settings.</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Agree & continue" onPress={onAccept} disabled={!accepted} loading={recordConsent.isPending} />
        {recordConsent.isError ? <Text style={styles.err}>Couldn't record consent. Please try again.</Text> : null}
      </View>
    </SafeAreaView>
  );
}

function humanize(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 24, gap: Spacing.md, alignItems: 'stretch' },
  iconBox: { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: InsuranceColors.okBg, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: Spacing.md },
  title: { ...Typography.titleLg, color: Colors.onSurface, textAlign: 'center' },
  subtitle: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { backgroundColor: InsuranceColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: InsuranceColors.border, padding: Spacing.md, gap: Spacing.sm },
  cardTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.4 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  fieldText: { ...Typography.bodyMd, color: Colors.onSurface },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: Spacing.xs },
  checkbox: { width: 22, height: 22, borderRadius: Radius.sm, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  consentText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 20 },
  policyLink: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  policyLinkText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background, gap: Spacing.xs },
  err: { ...Typography.labelSm, color: Colors.error, textAlign: 'center' },
});
