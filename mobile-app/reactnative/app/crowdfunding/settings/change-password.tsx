import React, { useState } from 'react';
import { ScrollView, View, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';

const RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
];

export default function ChangePasswordScreen() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const meetsAll = RULES.every((r) => r.test(next));
  const matches = next.length > 0 && next === confirm;
  const valid = current.length > 0 && meetsAll && matches;

  const save = () => {
    setSaving(true);
    setTimeout(() => { setSaving(false); setDone(true); }, 700);
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Password changed" showBack={false} />
        <StateView kind="empty" icon="ShieldCheck" title="Password updated" message="Your password was changed successfully. Use it next time you sign in." actionLabel="Done" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Change password" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <TextInputField label="Current password" value={current} onChangeText={setCurrent} secure autoCapitalize="none" />
          <TextInputField label="New password" value={next} onChangeText={setNext} secure autoCapitalize="none" />
          <TextInputField label="Confirm new password" value={confirm} onChangeText={setConfirm} secure autoCapitalize="none" error={confirm.length > 0 && !matches ? 'Passwords do not match' : undefined} />

          <View style={styles.rules}>
            {RULES.map((r) => {
              const ok = r.test(next);
              return (
                <View key={r.label} style={styles.ruleRow}>
                  <View style={[styles.ruleDot, ok && styles.ruleDotOk]}>{ok && <Check size={11} color={Colors.onPrimary} strokeWidth={3} />}</View>
                  <Text style={[styles.ruleText, ok && styles.ruleTextOk]}>{r.label}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Update password" onPress={save} disabled={!valid} loading={saving} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  rules: { gap: Spacing.sm, marginTop: Spacing.sm },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ruleDot: { width: 18, height: 18, borderRadius: 9999, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  ruleDotOk: { backgroundColor: Colors.tertiaryContainer, borderColor: Colors.tertiaryContainer },
  ruleText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  ruleTextOk: { color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
