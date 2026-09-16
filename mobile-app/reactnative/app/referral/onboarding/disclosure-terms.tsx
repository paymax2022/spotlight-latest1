import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { showToast } from '@/store/toastStore';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { ReferralHeader, DisclosureCard } from '@/features/referral/components';
import { useConsent, useRecordConsent } from '@/features/referral/foundation/hooks';

// M-ONB-03 — Earnings disclosure & T&Cs. Fair-earning terms, caps, no-exaggerated
// claims, explicit accept.
const TERMS = [
  'Earnings are tied to your friends’ verified activity and revenue — never to recruitment or signups alone.',
  'Rewards are capped per campaign and may vest over time before they can be withdrawn.',
  'We make no income guarantees. Results depend entirely on your friends’ real usage.',
  'Fraud — fake accounts, self-referral, paying people to "join" — leads to clawbacks, withholding and review.',
  'One verified identity earns once. Limits follow your KYC tier.',
];

export default function DisclosureTerms() {
  const { data, isLoading, isError, refetch } = useConsent();
  const record = useRecordConsent();
  const [accepted, setAccepted] = useState(false);

  const onAccept = () => {
    // Only advance once the acceptance is actually recorded — proceeding on a
    // failed write would onboard the user with no consent on file. Previously a
    // failure did nothing at all, leaving Accept looking broken.
    record.mutate(
      { kind: 'terms', granted: true },
      {
        onSuccess: () => router.push('/referral/onboarding/contacts-consent'),
        onError: () =>
          showToast({
            variant: 'error',
            title: 'Could not record your acceptance',
            message: 'Please try again.',
          }),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ReferralHeader title="Earnings terms" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load terms" actionLabel="Retry" onAction={refetch} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <DisclosureCard
              tone="compliant"
              title="Fair-earning terms"
              body="Please read and accept how earning works before you start inviting."
            />
            <View style={styles.list}>
              {TERMS.map((t, i) => (
                <View key={i} style={styles.termRow}>
                  <View style={styles.termDot} />
                  <Text style={styles.termText}>{t}</Text>
                </View>
              ))}
            </View>
            {data?.termsAcceptedAt ? (
              <Text style={styles.already}>You accepted these terms previously.</Text>
            ) : null}

            <Pressable style={styles.checkRow} onPress={() => setAccepted((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} aria-checked={accepted}>
              <View style={[styles.checkbox, accepted && styles.checkboxOn]}>{accepted && <Check size={14} color={Colors.onPrimary} strokeWidth={3} />}</View>
              <Text style={styles.checkLabel}>I have read and accept the fair-earning terms.</Text>
            </Pressable>
          </ScrollView>
          <View style={styles.footer}>
            <PrimaryButton label="Accept & continue" onPress={onAccept} disabled={!accepted} loading={record.isPending} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.md },
  list: { gap: Spacing.sm },
  termRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  termDot: { width: 6, height: 6, borderRadius: Radius.full, backgroundColor: Colors.primary, marginTop: 8 },
  termText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  already: { ...Typography.bodySm, color: Colors.onSurfaceVariant, fontStyle: 'italic' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
