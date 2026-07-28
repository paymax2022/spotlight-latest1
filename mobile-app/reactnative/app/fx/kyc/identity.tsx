import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import DatePickerField from '@/components/DatePickerField';
import UploadTile from '@/features/fx/components/UploadTile';
import { kycDraft } from '@/features/fx/utils/kycDraft';
import { ID_DOC_TYPES } from '@/features/fx/constants/fx.constants';
import type { IdDocType } from '@/features/fx/types/fx.types';

const DOC_LABELS = ID_DOC_TYPES.map((d) => d.label);
const labelToValue = (label: string): IdDocType =>
  (ID_DOC_TYPES.find((d) => d.label === label)?.value as IdDocType) ?? 'nin';
const valueToLabel = (v: IdDocType) => ID_DOC_TYPES.find((d) => d.value === v)?.label ?? DOC_LABELS[0];

export default function KycIdentityScreen() {
  const id = kycDraft.current.identity;
  const [docLabel, setDocLabel] = useState(valueToLabel(id.docType));
  const [idNumber, setIdNumber] = useState(id.idNumber);
  const [dob, setDob] = useState(id.dateOfBirth);
  const [front, setFront] = useState(id.frontUploaded);
  const [back, setBack] = useState(id.backUploaded);

  const ready = idNumber.trim().length >= 5 && !!dob && front && back;

  const next = () => {
    kycDraft.current.identity = { ...id, docType: labelToValue(docLabel), idNumber, dateOfBirth: dob, frontUploaded: front, backUploaded: back };
    router.push('/fx/kyc/selfie');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Identity" subtitle="Step 3 of 4" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <SelectField label="Document type" value={docLabel} options={DOC_LABELS} searchable={false} onChange={setDocLabel} />
          <TextInputField label="Document number" value={idNumber} onChangeText={setIdNumber} placeholder="Enter the number on your ID" autoCapitalize="characters" />
          <DatePickerField label="Date of birth" value={dob} onChange={setDob} />

          <Text style={styles.uploadLabel}>Upload your document</Text>
          <View style={styles.uploads}>
            <UploadTile label="Front of document" hint="Clear, well-lit photo" uploaded={front} onPress={() => setFront(true)} />
            <UploadTile label="Back of document" hint="Clear, well-lit photo" uploaded={back} onPress={() => setBack(true)} />
          </View>
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Continue" onPress={next} disabled={!ready} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin },
  uploadLabel: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  uploads: { gap: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
