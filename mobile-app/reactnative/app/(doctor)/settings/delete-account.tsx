import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard } from '@/features/doctor/components';
import { useRequestAccountDeletion } from '@/features/doctor/hooks';
import { confirmAsync, alertAsync } from '@/lib/confirm';

// ── Section AC — Delete account request (AC.16) ───────────────────────────────
// NEW screen: a gated account-deletion request. Imports the SINGLE shared
// useRequestAccountDeletion (declared in useComplianceCenter / Section AB) — not
// re-declared here. Gated by typing DELETE + a destructive confirm.

const CONFIRM_WORD = 'DELETE';

export default function DeleteAccountScreen() {
  const remove = useRequestAccountDeletion();
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');

  const gated = confirmText.trim().toUpperCase() === CONFIRM_WORD;

  const handleDelete = async () => {
    if (!gated) { alertAsync({ title: 'Confirm required', message: `Type ${CONFIRM_WORD} to confirm.` }); return; }
    const ok = await confirmAsync({
      title: 'Delete your account?',
      message: 'This permanently deletes your account and data and cannot be undone.',
      confirmLabel: 'Delete account',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync({ reason: reason.trim() || undefined });
      await alertAsync({ title: 'Request submitted', message: 'Your account deletion request has been received.' });
      router.back();
    } catch {
      await alertAsync({ title: 'Failed', message: 'Could not submit your request. Please try again.' });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Delete Account" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.warning}>
            <AlertTriangle size={22} color={Colors.error} strokeWidth={2} />
            <Text style={styles.warningText}>Deleting your account is permanent. Active consults, payouts and records will be closed.</Text>
          </View>

          <SectionCard style={styles.card}>
            <TextInputField label="Reason (optional)" placeholder="Tell us why you're leaving" value={reason} onChangeText={setReason} />
            <TextInputField label={`Type ${CONFIRM_WORD} to confirm`} placeholder={CONFIRM_WORD} value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" />
            <PrimaryButton label="Request account deletion" onPress={handleDelete} loading={remove.isPending} disabled={!gated} variant="ghost" />
          </SectionCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  flex:        { flex: 1 },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  warning:     { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  warningText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  card:        { marginBottom: Spacing.md },
});
