import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MessageSquareWarning, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useSubmitAppeal } from '@/features/visitor/hooks/useVisitor';

const REASONS = ['Payment already made', 'Billing error', 'Financial hardship', 'Disputing the charge', 'Other'];

export default function AppealRestrictionScreen() {
  const submit = useSubmitAppeal();
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const onSubmit = () => {
    setError('');
    if (!reason) { setError('Please choose a reason for your appeal.'); return; }
    submit.mutate(undefined, { onSuccess: () => setDone(true) });
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Appeal submitted" showBack={false} />
        <View style={styles.resultWrap}>
          <View style={[styles.bigIcon, { backgroundColor: Colors.iconBgBlue }]}>
            <Clock size={44} color={Colors.secondary} strokeWidth={1.6} />
          </View>
          <Text style={styles.resultTitle}>Appeal under review</Text>
          <Text style={styles.resultBody}>An estate admin will review your appeal and respond. The decision is logged to the payment-ban audit trail.</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Back to visitor access" onPress={() => router.replace('/visitor/restricted')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Appeal restriction" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={[styles.hero, { backgroundColor: Colors.iconBgPurple }]}>
            <MessageSquareWarning size={22} color={Colors.primary} strokeWidth={1.8} />
            <Text style={styles.heroText}>Request a waiver or dispute your visitor-access restriction.</Text>
          </View>

          <Text style={styles.label}>Reason</Text>
          <View style={styles.reasonWrap}>
            {REASONS.map((r) => {
              const selected = r === reason;
              return (
                <Pressable key={r} onPress={() => setReason(r)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && styles.chipSelected]}>
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{r}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInputField label="Details (optional)" placeholder="Add anything the admin should know…" value={detail} onChangeText={setDetail} multiline numberOfLines={4} style={styles.detailInput} />

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Submit appeal" onPress={onSubmit} loading={submit.isPending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.lg, padding: Spacing.md },
  heroText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  chipSelected: { borderColor: Colors.primary, backgroundColor: Colors.iconBgPurple },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextSelected: { color: Colors.primary },
  detailInput: { minHeight: 96, textAlignVertical: 'top', paddingTop: Spacing.sm },
  error: { ...Typography.labelMd, color: Colors.error },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
  resultWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  bigIcon: { width: 92, height: 92, borderRadius: Radius.xxl, alignItems: 'center', justifyContent: 'center' },
  resultTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  resultBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
