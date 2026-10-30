import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { kycVerifyDraft } from '@/features/kycverify/draft';
import { useUsedIdTypes } from '@/features/kycverify/hooks';
import type { KycTier } from '@/features/kycverify/types';
import { ID_FORMATS, validateIdNumber } from '@/features/kycverify/idFormats';
import IdNumberField from '@/features/kycverify/components/IdNumberField';
import DojahRequirement from '@/features/kycverify/components/DojahRequirement';

/**
 * K5 — ID number entry. The field enforces the exact shape Dojah's endpoint for
 * this identifier expects (see idFormats.ts, which mirrors the Go adapter's
 * routes), and the screen states that requirement plus the masked request before
 * anything is sent.
 *
 * We do NOT collect the holder's name or date of birth: Dojah returns the
 * authoritative legal name + DOB from the registry lookup and the backend
 * persists those. Asking the user to type them was redundant and let a typo
 * diverge from the verified record.
 */
export default function KycIdNumberScreen() {
  const draft = kycVerifyDraft.current;

  // Direct visits skip the picker: never accept an ID type already used at a
  // lower tier (the server refuses it as well).
  const used = useUsedIdTypes(draft.targetTier as KycTier);
  const idTypeUsed = (used.data ?? []).includes(draft.idType.toLowerCase());
  useEffect(() => {
    if (idTypeUsed) router.replace('/kyc-verify/id-type');
  }, [idTypeUsed]);

  const idType = draft.idType;
  const format = ID_FORMATS[idType];

  const [idNumber, setIdNumber] = useState(draft.idNumber);
  const [touched, setTouched] = useState(false);

  const validation = validateIdNumber(idType, idNumber);
  const showError = touched && idNumber.length > 0 ? validation.error : undefined;

  const next = () => {
    if (!validation.ok) {
      setTouched(true);
      return;
    }
    kycVerifyDraft.current.idNumber = validation.normalized;
    router.push('/kyc-verify/id-verifying');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Enter your ${format.label}`} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <IdNumberField
            idType={idType}
            value={idNumber}
            onChangeText={(raw) => {
              setTouched(true);
              setIdNumber(raw);
            }}
            error={showError}
          />
          <DojahRequirement idType={idType} idNumber={validation.normalized} />
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Verify" onPress={next} disabled={!validation.ok} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  content: { padding: Spacing.containerMargin },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
