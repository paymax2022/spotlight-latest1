import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useCreateTicket } from '@/features/association/hooks/useSettings';
import { TICKET_CATEGORY_OPTIONS, TICKET_CATEGORY_LABEL } from '@/features/association/constants/support.constants';
import type { TicketCategory } from '@/features/association/types/settings.types';

export default function NewTicket() {
  const create = useCreateTicket();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('MEMBERSHIP');
  const [message, setMessage] = useState('');
  const [touched, setTouched] = useState(false);

  const valid = subject.trim().length > 3 && message.trim().length > 10;

  const onSubmit = () => {
    setTouched(true);
    if (!valid) return;
    create.mutate({ subject: subject.trim(), category, message: message.trim() }, {
      onSuccess: (res) => router.replace(`/association/support/${res.id}`),
      onError: () => Alert.alert('Could not submit', 'Please try again.'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Contact support" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInputField label="Subject" placeholder="Brief summary of your issue" value={subject} onChangeText={setSubject} error={touched && subject.trim().length <= 3 ? 'Enter a subject' : undefined} />

        <Text style={styles.label}>Category</Text>
        <View style={styles.catRow}>
          {TICKET_CATEGORY_OPTIONS.map((c) => {
            const active = category === c;
            return (
              <Pressable key={c} onPress={() => setCategory(c)} style={[styles.catChip, active && styles.catChipActive]} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={TICKET_CATEGORY_LABEL[c]}>
                <Text style={[styles.catText, active && styles.catTextActive]}>{TICKET_CATEGORY_LABEL[c]}</Text>
              </Pressable>
            );
          })}
        </View>

        <TextInputField label="Message" placeholder="Describe your issue in detail…" value={message} onChangeText={setMessage} multiline numberOfLines={6} error={touched && message.trim().length <= 10 ? 'Add a bit more detail' : undefined} />
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Submit ticket" onPress={onSubmit} loading={create.isPending} disabled={touched && !valid} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md, paddingTop: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: -Spacing.xs },
  catChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  catChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  catText: { ...Typography.labelMd, color: Colors.onSurface },
  catTextActive: { color: Colors.onPrimary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
