import React, { useState } from 'react';
import { Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard } from '@/features/doctor/components';
import { useChangePassword } from '@/features/doctor/hooks';

// ── Section AC — Change password (AC.8) ───────────────────────────────────────
// NEW screen. Reuses TextInputField (secure) + PrimaryButton. Local validation
// only; the mutation auto-generates the idempotency key.

export default function ChangePasswordScreen() {
  const change = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const matches = newPassword.length > 0 && newPassword === confirm;
  const longEnough = newPassword.length >= 8;
  const canSubmit = currentPassword.length > 0 && longEnough && matches;

  const handleSubmit = async () => {
    if (!canSubmit) {
      Alert.alert('Check your input', 'Use at least 8 characters and make sure both new passwords match.');
      return;
    }
    try {
      await change.mutateAsync({ currentPassword, newPassword });
      Alert.alert('Password changed', 'Your password has been updated.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch {
      Alert.alert('Failed', 'Could not change your password. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Change Password" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SectionCard style={styles.card}>
            <TextInputField label="Current password" placeholder="••••••••" value={currentPassword} onChangeText={setCurrentPassword} secure />
            <TextInputField label="New password" placeholder="At least 8 characters" value={newPassword} onChangeText={setNewPassword} secure error={newPassword.length > 0 && !longEnough ? 'Use at least 8 characters' : undefined} />
            <TextInputField label="Confirm new password" placeholder="Re-enter new password" value={confirm} onChangeText={setConfirm} secure error={confirm.length > 0 && !matches ? 'Passwords do not match' : undefined} />
            <PrimaryButton label="Update password" onPress={handleSubmit} loading={change.isPending} disabled={!canSubmit} />
          </SectionCard>
          <Text style={styles.hint}>You will stay signed in on this device after changing your password.</Text>
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
