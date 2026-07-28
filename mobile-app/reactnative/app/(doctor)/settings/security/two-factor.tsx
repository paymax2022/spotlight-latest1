import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView } from '@/features/doctor/components';
import { useSecuritySettings, useSetTwoFactor } from '@/features/doctor/hooks';
import { TWO_FACTOR_METHODS, TWO_FACTOR_METHOD_LABELS } from '@/features/doctor/constants';
import type { TwoFactorMethod, TwoFactorSetup } from '@/types/doctor.batch7';

// ── Section AC — Two-factor authentication setup (AC.10) ──────────────────────
// NEW screen: choose a 2FA method, start enrolment (returns a TwoFactorSetup
// with masked target / recovery codes) and confirm with a code, or turn 2FA off.
// Reuses SelectField / TextInputField / PrimaryButton.

const ENABLE_METHODS = TWO_FACTOR_METHODS.filter((m) => m.value !== 'none');

export default function TwoFactorScreen() {
  const { data: security, isLoading, isError, refetch } = useSecuritySettings();
  const setTwoFactor = useSetTwoFactor();

  const [method, setMethod] = useState<TwoFactorMethod>();
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<TwoFactorSetup>();

  const start = async () => {
    if (!method) { Alert.alert('Choose a method', 'Select a two-factor method to continue.'); return; }
    try {
      const result = await setTwoFactor.mutateAsync({ enabled: true, method });
      setSetup(result.setup);
      if (!result.setup) Alert.alert('Two-factor enabled', 'Two-factor authentication is now active.');
    } catch {
      Alert.alert('Failed', 'Could not start two-factor setup. Please try again.');
    }
  };

  const confirm = async () => {
    if (!method || code.trim().length === 0) { Alert.alert('Enter the code', 'Enter the verification code to finish setup.'); return; }
    try {
      await setTwoFactor.mutateAsync({ enabled: true, method, code: code.trim() });
      Alert.alert('Two-factor enabled', 'Two-factor authentication is now active.');
      setSetup(undefined);
      setCode('');
    } catch {
      Alert.alert('Failed', 'Could not verify the code. Please try again.');
    }
  };

  const disable = async () => {
    try {
      await setTwoFactor.mutateAsync({ enabled: false, method: 'none' });
      Alert.alert('Two-factor disabled', 'Two-factor authentication has been turned off.');
    } catch {
      Alert.alert('Failed', 'Could not disable two-factor. Please try again.');
    }
  };

  const labelOfMethod = method ? TWO_FACTOR_METHOD_LABELS[method] : undefined;
  const methodFromLabel = (l: string): TwoFactorMethod => (ENABLE_METHODS.find((m) => m.label === l)?.value ?? 'authenticator');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Two-Factor Auth" />
      {isLoading && !security ? (
        <StateView variant="loading" label="Loading" />
      ) : isError || !security ? (
        <StateView variant="error" message="We could not load your security settings." onRetry={() => refetch()} />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {security.twoFactorEnabled ? (
              <SectionCard title="Two-factor is on" style={styles.card}>
                <Text style={styles.body}>Method: {TWO_FACTOR_METHOD_LABELS[security.twoFactorMethod]}</Text>
                <PrimaryButton label="Turn off two-factor" onPress={disable} loading={setTwoFactor.isPending} variant="ghost" style={styles.btn} />
              </SectionCard>
            ) : !setup ? (
              <SectionCard title="Choose a method" style={styles.card}>
                <SelectField label="Method" placeholder="Select a method" value={labelOfMethod} options={ENABLE_METHODS.map((m) => m.label)} onChange={(l) => setMethod(methodFromLabel(l))} />
                <PrimaryButton label="Start setup" onPress={start} loading={setTwoFactor.isPending} disabled={!method} />
              </SectionCard>
            ) : (
              <SectionCard title="Verify setup" style={styles.card}>
                {!!setup.otpauthUrl && <Text style={styles.body}>Scan the QR in your authenticator app, then enter the 6-digit code.</Text>}
                {!!setup.maskedTarget && <Text style={styles.body}>We sent a code to {setup.maskedTarget}.</Text>}
                {!!setup.secret && (
                  <View style={styles.secretBox}>
                    <Text style={styles.secretLabel}>Setup key</Text>
                    <Text style={styles.secret}>{setup.secret}</Text>
                  </View>
                )}
                <TextInputField label="Verification code" placeholder="123456" value={code} onChangeText={setCode} keyboardType="number-pad" />
                {!!setup.recoveryCodes?.length && (
                  <View style={styles.secretBox}>
                    <Text style={styles.secretLabel}>Recovery codes (save these)</Text>
                    {setup.recoveryCodes.map((c) => <Text key={c} style={styles.secret}>{c}</Text>)}
                  </View>
                )}
                <PrimaryButton label="Confirm & enable" onPress={confirm} loading={setTwoFactor.isPending} disabled={code.trim().length === 0} />
              </SectionCard>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  flex:        { flex: 1 },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:        { marginBottom: Spacing.md },
  body:        { ...Typography.bodyMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  btn:         { marginTop: Spacing.sm },
  secretBox:   { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md, gap: 4 },
  secretLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  secret:      { ...Typography.labelLg, color: Colors.onSurface },
});
