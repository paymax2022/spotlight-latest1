import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import DatePickerField from '@/components/DatePickerField';
import { ID_NUMBER_HELP } from '@/features/kycverify/constants';
import { kycVerifyDraft } from '@/features/kycverify/draft';

/**
 * K5 — ID number entry. Inline validation (length for BVN/NIN) + a "why we need
 * this" helper. Saves to draft (save-as-you-go), then runs the check on K6.
 */
export default function KycIdNumberScreen() {
  const draft = kycVerifyDraft.current;
  const help = ID_NUMBER_HELP[draft.idType];

  const [idNumber, setIdNumber] = useState(draft.idNumber);
  const [firstName, setFirstName] = useState(draft.firstName);
  const [lastName, setLastName] = useState(draft.lastName);
  const [dob, setDob] = useState(draft.dob);

  const digitsOnly = draft.idType === 'BVN' || draft.idType === 'NIN';
  const cleaned = idNumber.trim();
  const lengthOk = help.length ? cleaned.replace(/\D/g, '').length === help.length : cleaned.length >= 4;
  const error =
    cleaned.length === 0
      ? undefined
      : !lengthOk
      ? help.length
        ? `Enter your ${help.length}-digit ${draft.idType}.`
        : 'Enter a valid ID number.'
      : undefined;

  const ready = lengthOk && !!dob;

  const next = () => {
    kycVerifyDraft.current.idNumber = cleaned;
    kycVerifyDraft.current.firstName = firstName.trim();
    kycVerifyDraft.current.lastName = lastName.trim();
    kycVerifyDraft.current.dob = dob;
    router.push('/kyc-verify/id-verifying');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Enter your ${draft.idType}`} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextInputField
            label={`${draft.idType} number`}
            value={idNumber}
            onChangeText={setIdNumber}
            placeholder={help.placeholder}
            keyboardType={digitsOnly ? 'number-pad' : 'default'}
            autoCapitalize="characters"
            autoCorrect={false}
            error={error}
          />

          <View style={styles.whyBox}>
            <Info size={16} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.whyText}>{help.why}</Text>
          </View>

          <Text style={styles.section}>Your details (as on the ID)</Text>
          <TextInputField label="First name" value={firstName} onChangeText={setFirstName} placeholder="First name" autoCapitalize="words" />
          <TextInputField label="Last name" value={lastName} onChangeText={setLastName} placeholder="Last name" autoCapitalize="words" />
          <DatePickerField label="Date of birth" value={dob} onChange={setDob} />
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Verify" onPress={next} disabled={!ready} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  content: { padding: Spacing.containerMargin },
  whyBox: {
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md,
  },
  whyText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  section: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
