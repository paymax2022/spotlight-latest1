import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import { sanitizeMoneyInput } from '@/utils/money';
import { TeleHeader } from '@/features/telemedicine/components';
import { SoapSection, SectionCard } from '@/features/doctor/components';
import { useCreateDispute } from '@/features/doctor/hooks';
import { DISPUTE_KIND_LABELS } from '@/features/doctor/constants';
import type { DisputeKind } from '@/types/doctor.batch7';

// ── Section AA — Create dispute (AA.7-14, unified by kind) ─────────────────────
// NEW screen: a single create flow keyed by DisputeKind. Reference label adapts
// to the kind (consultation/payment/pharmacy/lab/HMO/prescription/call/
// complaint). naming: reference field is `referenceValue`, never `ref` (reserved).

const KIND_ORDER: DisputeKind[] = [
  'consultation', 'payment', 'pharmacy', 'lab', 'hmo', 'prescription', 'call_failure', 'patient_complaint',
];

const REF_LABEL: Record<DisputeKind, string> = {
  consultation:      'Consultation reference',
  payment:           'Payment / payout reference',
  pharmacy:          'Pharmacy fulfilment reference',
  lab:               'Lab order reference',
  hmo:               'HMO claim reference',
  prescription:      'Prescription reference',
  call_failure:      'Consultation reference',
  patient_complaint: 'Patient name',
};

const SHOWS_AMOUNT: Partial<Record<DisputeKind, boolean>> = { payment: true, hmo: true };

export default function NewDisputeScreen() {
  const params = useLocalSearchParams<{ kind?: string }>();
  const create = useCreateDispute();

  const labelToKind = useMemo(() => {
    const m: Record<string, DisputeKind> = {};
    KIND_ORDER.forEach((k) => { m[DISPUTE_KIND_LABELS[k]] = k; });
    return m;
  }, []);
  const kindOptions = useMemo(() => KIND_ORDER.map((k) => DISPUTE_KIND_LABELS[k]), []);

  const initialKind = (params.kind && KIND_ORDER.includes(params.kind as DisputeKind)) ? (params.kind as DisputeKind) : undefined;
  const [kind, setKind] = useState<DisputeKind | undefined>(initialKind);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [referenceValue, setReferenceValue] = useState('');
  const [amountNaira, setAmountNaira] = useState('');

  const canSubmit = !!kind && subject.trim().length > 0 && description.trim().length > 0;

  const buildRefPatch = (k: DisputeKind): Record<string, string | number | undefined> => {
    const v = referenceValue.trim() || undefined;
    switch (k) {
      case 'consultation':
      case 'call_failure':      return { consultRef: v };
      case 'payment':           return { paymentRef: v };
      case 'pharmacy':          return { pharmacyRef: v };
      case 'lab':               return { labRef: v };
      case 'hmo':               return { hmoClaimRef: v };
      case 'prescription':      return { prescriptionRef: v };
      case 'patient_complaint': return { patientName: v };
      default:                  return {};
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || !kind) {
      Alert.alert('Incomplete', 'Choose a dispute type and fill in the subject and description.');
      return;
    }
    const amountKobo = SHOWS_AMOUNT[kind] && amountNaira.trim()
      ? Math.round(Number(amountNaira.replace(/[^0-9.]/g, '')) * 100)
      : undefined;
    try {
      const result = await create.mutateAsync({
        kind,
        subject: subject.trim(),
        description: description.trim(),
        amountKobo,
        ...buildRefPatch(kind),
      });
      Alert.alert('Dispute raised', `${result.ref} has been opened.`, [
        { text: 'OK', onPress: () => router.replace({ pathname: '/(doctor)/support/dispute/[id]', params: { id: result.disputeId } }) },
      ]);
    } catch {
      Alert.alert('Failed', 'Could not raise the dispute. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Raise a Dispute" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SectionCard title="Dispute details" style={styles.card}>
            <SelectField
              label="Dispute type"
              placeholder="Select a type"
              value={kind ? DISPUTE_KIND_LABELS[kind] : undefined}
              options={kindOptions}
              onChange={(label) => setKind(labelToKind[label])}
            />
            {kind && (
              <>
                <TextInputField label={REF_LABEL[kind]} placeholder="Optional reference" value={referenceValue} onChangeText={setReferenceValue} />
                {SHOWS_AMOUNT[kind] && (
                  <TextInputField label="Disputed amount (₦)" placeholder="0.00" value={amountNaira} onChangeText={(v) => setAmountNaira(sanitizeMoneyInput(v))} keyboardType="decimal-pad" maxLength={13} />
                )}
              </>
            )}
            <TextInputField label="Subject" placeholder="Brief summary" value={subject} onChangeText={setSubject} />
            <SoapSection label="What happened?" value={description} onChangeText={setDescription} placeholder="Describe the issue in detail…" />
            <PrimaryButton label="Submit dispute" onPress={handleSubmit} loading={create.isPending} disabled={!canSubmit} />
          </SectionCard>
          <Text style={styles.hint}>You can add evidence after the dispute is created.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  flex:    { flex: 1 },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:    { marginBottom: Spacing.md },
  hint:    { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
