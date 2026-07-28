import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SoapSection, SectionCard } from '@/features/doctor/components';
import { useCreateSupportTicket } from '@/features/doctor/hooks';
import { SUPPORT_CATEGORIES } from '@/features/doctor/constants';

// ── Section AA — Create / contact support ticket (AA.3 / AA.5 / AA.6) ──────────
// NEW screen. REUSES the Phase 1 useCreateSupportTicket mutation. When a
// `category` param is passed (e.g. Technical from the hub) it pre-selects it, so
// the "report a technical issue" entry point is the same screen with a preset.

export default function NewSupportTicketScreen() {
  const params = useLocalSearchParams<{ category?: string }>();
  const create = useCreateSupportTicket();

  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<string | undefined>(params.category);
  const [body, setBody] = useState('');

  const canSubmit = subject.trim().length > 0 && !!category && body.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || !category) {
      Alert.alert('Incomplete', 'Fill in the subject, category and message.');
      return;
    }
    try {
      const result = await create.mutateAsync({ subject: subject.trim(), category, body: body.trim() });
      Alert.alert('Ticket created', `${result.ref} has been opened. We'll get back to you shortly.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert('Failed', 'Could not create your ticket. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title={params.category === 'Technical' ? 'Report an Issue' : 'Contact Support'} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SectionCard title="Open a new ticket" style={styles.card}>
            <TextInputField label="Subject" placeholder="Brief summary" value={subject} onChangeText={setSubject} />
            <SelectField label="Category" placeholder="Select a category" value={category} options={SUPPORT_CATEGORIES} onChange={setCategory} />
            <SoapSection label="Message" value={body} onChangeText={setBody} placeholder="Describe your issue…" />
            <PrimaryButton label="Submit ticket" onPress={handleSubmit} loading={create.isPending} disabled={!canSubmit} />
          </SectionCard>
          <Text style={styles.hint}>Our team typically responds within one business day.</Text>
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
