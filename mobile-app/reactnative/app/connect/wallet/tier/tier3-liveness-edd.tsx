import React, { useState, useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import CaptureRow from '@/features/connect/components/wallet-CaptureRow';
import { useSubmitTier3 } from '@/features/connect/wallet/hooks';
import { sanitizeMoneyInput, nairaStringToKobo } from '@/utils/money';

// WL-15 — Tier 3: liveness check + enhanced due diligence (EDD). Unlocks the
// highest gifting & withdrawal ceilings.
export default function Tier3LivenessEdd() {
  const submit = useSubmitTier3();
  const [livenessUri, setLivenessUri] = useState('');
  const [sourceOfFunds, setSourceOfFunds] = useState('');
  const [occupation, setOccupation] = useState('');
  const [volumeNaira, setVolumeNaira] = useState('');

  const volumeKobo = useMemo(() => nairaStringToKobo(volumeNaira), [volumeNaira]);

  const valid = !!livenessUri && !!sourceOfFunds && !!occupation && volumeKobo > 0;

  const onSubmit = () => {
    if (!valid) return;
    submit.mutate(
      { livenessUri, sourceOfFunds, occupation, expectedMonthlyVolumeKobo: volumeKobo },
      {
        onSuccess: () => router.replace('/connect/wallet/tier/pending'),
        onError: (e: unknown) => Alert.alert('Submission failed', e instanceof Error ? e.message : 'Please try again.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Tier 3 · Liveness & EDD" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Tier 3 removes fixed limits and unlocks the highest gifting and withdrawal ceilings.
          A liveness check and enhanced due diligence are required.
        </Text>

        <Text style={styles.label}>Liveness check</Text>
        <CaptureRow icon="ScanFace" label="Record a liveness selfie" hint="Follow the on-screen prompts"
          done={!!livenessUri} onPress={() => setLivenessUri(`mock://liveness_${Date.now()}`)} />

        <Text style={styles.label}>Enhanced due diligence</Text>
        <TextInputField label="Source of funds" value={sourceOfFunds} onChangeText={setSourceOfFunds}
          placeholder="e.g. Salary, business income" />
        <TextInputField label="Occupation" value={occupation} onChangeText={setOccupation} placeholder="Your occupation" />
        <TextInputField label="Expected monthly volume (₦)" value={volumeNaira}
          onChangeText={(t) => setVolumeNaira(sanitizeMoneyInput(t))} keyboardType="decimal-pad"
          placeholder="0" inputMode="decimal" maxLength={13} />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Submit for review" onPress={onSubmit} disabled={!valid} loading={submit.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
