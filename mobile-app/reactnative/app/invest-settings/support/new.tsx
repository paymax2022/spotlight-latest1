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
import { useCreateTicket } from '@/features/investsettings/hooks/useSettings';

export default function NewTicketScreen() {
  const create = useCreateTicket();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | undefined>();

  const submit = () => {
    if (subject.trim().length < 4) { setError('Add a short subject.'); return; }
    if (body.trim().length < 10) { setError('Describe your issue in a little more detail.'); return; }
    setError(undefined);
    create.mutate(
      { subject: subject.trim(), body: body.trim() },
      {
        onSuccess: (ticket) => {
          router.replace(`/invest-settings/support/${ticket.id}`);
        },
        onError: (e: unknown) => setError((e as Error).message),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New ticket" subtitle="Tell us what's going on" />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <TextInputField
            label="Subject"
            placeholder="e.g. Withdrawal not received"
            value={subject}
            onChangeText={setSubject}
            maxLength={80}
          />
          <TextInputField
            label="Describe your issue"
            placeholder="Include any reference numbers and what you expected to happen."
            value={body}
            onChangeText={setBody}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            style={styles.bodyInput}
            error={error}
          />
          <Text style={styles.note}>
            We'll reply in this thread and notify you when support responds.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton label="Submit ticket" onPress={submit} loading={create.isPending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin },
  bodyInput: { minHeight: 120 },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
});
