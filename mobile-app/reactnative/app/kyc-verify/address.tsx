import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import PrivacyNote from '@/features/kycverify/components/PrivacyNote';
import { useAmlCheck } from '@/features/kycverify/hooks';
import { kycVerifyDraft, markPassed } from '@/features/kycverify/draft';
import { nextStepRoute } from '@/features/kycverify/flow';

/**
 * K10 — Address (Tier 3). Collects residential address for EDD, then runs the
 * AML / sanctions / address screening (POST /checks/aml, Idempotency-Key).
 */
export default function KycAddressScreen() {
  const draft = kycVerifyDraft.current;
  const [line, setLine] = useState(draft.addressLine);
  const [city, setCity] = useState(draft.city);
  const [state, setState] = useState(draft.state);
  const aml = useAmlCheck();

  const ready = line.trim().length >= 4 && city.trim().length >= 2 && state.trim().length >= 2;

  const submit = async () => {
    if (!draft.sessionId) return;
    kycVerifyDraft.current.addressLine = line.trim();
    kycVerifyDraft.current.city = city.trim();
    kycVerifyDraft.current.state = state.trim();
    try {
      const check = await aml.mutateAsync(draft.sessionId);
      if (check.status === 'PASSED') {
        markPassed('aml');
        router.replace(nextStepRoute(kycVerifyDraft.current));
      } else if (check.status === 'PENDING' || check.status === 'REVIEW') {
        router.replace('/kyc-verify/pending');
      } else {
        router.replace({ pathname: '/kyc-verify/failed', params: { reason: check.reason ?? '', check: 'aml' } });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not run the screening. Please try again.';
      Alert.alert('Screening failed', message);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your address" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.sub}>
            Why: Tier 3 requires enhanced due diligence, including your residential address and a sanctions screening.
          </Text>

          <TextInputField label="Street address" value={line} onChangeText={setLine} placeholder="House number and street" autoCapitalize="words" />
          <TextInputField label="City / town" value={city} onChangeText={setCity} placeholder="City" autoCapitalize="words" />
          <TextInputField label="State" value={state} onChangeText={setState} placeholder="State" autoCapitalize="words" />

          {aml.isPending ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.busyText}>Running sanctions & address screening…</Text>
            </View>
          ) : null}

          <PrivacyNote>
            Your address is screened against sanctions and PEP lists for compliance only. We don't use it for marketing.
          </PrivacyNote>
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Submit & screen" onPress={submit} disabled={!ready || aml.isPending} loading={aml.isPending} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  busyText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
