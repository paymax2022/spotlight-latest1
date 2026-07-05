import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import CaptureRow from '@/features/connect/components/wallet-CaptureRow';
import { formatKobo } from '@/features/connect/constants/format';
import type { Tier2Input } from '@/features/connect/wallet/types';
import { useSubmitTier2 } from '@/features/connect/wallet/hooks';

// WL-14 — Tier 2: photo ID + proof of address. Enables withdrawals and a
// ₦500,000/day limit. Documents are captured (mock stubs a URI).
const ID_TYPES: { value: Tier2Input['idType']; label: string }[] = [
  { value: 'national_id', label: 'National ID' },
  { value: 'passport', label: 'Passport' },
  { value: 'drivers_license', label: "Driver's licence" },
  { value: 'voters_card', label: "Voter's card" },
];

export default function Tier2IdAddress() {
  const submit = useSubmitTier2();
  const [idType, setIdType] = useState<Tier2Input['idType']>('national_id');
  const [idDocumentUri, setIdDocumentUri] = useState('');
  const [proofOfAddressUri, setProofOfAddressUri] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');

  const valid = !!idDocumentUri && !!proofOfAddressUri && !!addressLine && !!city && !!state;

  const onSubmit = () => {
    if (!valid) return;
    submit.mutate(
      { idType, idDocumentUri, proofOfAddressUri, addressLine, city, state },
      {
        onSuccess: () => router.replace('/connect/wallet/tier/pending'),
        onError: (e: unknown) => Alert.alert('Submission failed', e instanceof Error ? e.message : 'Please try again.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Tier 2 · ID & address" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Tier 2 enables withdrawals and raises your daily limit to {formatKobo(50_000_000)}.
        </Text>

        <Text style={styles.label}>ID type</Text>
        <View style={styles.chips}>
          {ID_TYPES.map((t) => (
            <Pressable key={t.value} style={[styles.chip, idType === t.value && styles.chipActive]} onPress={() => setIdType(t.value)}>
              <Text style={[styles.chipText, idType === t.value && styles.chipTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <CaptureRow icon="CreditCard" label="Photo of your ID" hint="Front of the document"
          done={!!idDocumentUri} onPress={() => setIdDocumentUri(`mock://id_${Date.now()}`)} />
        <CaptureRow icon="FileText" label="Proof of address" hint="Utility bill or bank statement"
          done={!!proofOfAddressUri} onPress={() => setProofOfAddressUri(`mock://poa_${Date.now()}`)} />

        <Text style={styles.label}>Residential address</Text>
        <TextInputField value={addressLine} onChangeText={setAddressLine} placeholder="Street address" />
        <View style={styles.row}>
          <View style={{ flex: 1 }}><TextInputField value={city} onChangeText={setCity} placeholder="City" /></View>
          <View style={{ flex: 1 }}><TextInputField value={state} onChangeText={setState} placeholder="State" /></View>
        </View>
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh },
  chipActive: { borderColor: Colors.primary, backgroundColor: Colors.iconBgPurple },
  chipText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.primary },
  row: { flexDirection: 'row', gap: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
