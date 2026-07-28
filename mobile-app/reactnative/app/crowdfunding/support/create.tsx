import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useCreateTicket } from '@/features/crowdfunding/hooks/useExtras';
import type { TicketCategory } from '@/features/crowdfunding/types/crowdfunding.types';

const CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: 'CAMPAIGN', label: 'Campaign issue' },
  { value: 'PAYMENT', label: 'Payment' },
  { value: 'REFUND', label: 'Refund' },
  { value: 'REWARD', label: 'Reward' },
  { value: 'WITHDRAWAL', label: 'Withdrawal' },
  { value: 'FAKE_CAMPAIGN', label: 'Report fake campaign' },
  { value: 'OTHER', label: 'Other' },
];

export default function CreateTicketScreen() {
  const create = useCreateTicket();
  const [category, setCategory] = useState<TicketCategory | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const valid = category && subject.trim().length > 3 && body.trim().length > 10;

  const submit = () => {
    if (!category) return;
    create.mutate(
      { category, subject: subject.trim(), body: body.trim() },
      { onSuccess: (t) => router.replace(`/crowdfunding/support/ticket/${t.id}`) },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Contact support" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>What's it about?</Text>
          <View style={styles.chipWrap}>
            {CATEGORIES.map((c) => {
              const active = category === c.value;
              return (
                <Pressable key={c.value} style={[styles.chip, active && styles.chipActive]} onPress={() => setCategory(c.value)} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ height: Spacing.lg }} />
          <TextInputField label="Subject" placeholder="Brief summary" value={subject} onChangeText={setSubject} />

          <Text style={styles.label}>Describe the issue</Text>
          <TextInput style={styles.editor} placeholder="Give us as much detail as you can…" placeholderTextColor={Colors.outline} value={body} onChangeText={setBody} multiline textAlignVertical="top" />
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Submit ticket" onPress={submit} disabled={!valid} loading={create.isPending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, paddingVertical: 9 },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { ...Typography.labelSm, color: Colors.onSurface },
  chipTextActive: { color: Colors.onPrimary },
  editor: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, minHeight: 120, ...Typography.bodyMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
