import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Check, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';

const REASONS = [
  'Suspected fake campaign',
  'Misleading information',
  'Fraudulent beneficiary',
  'Prohibited / illegal cause',
  'Spam or duplicate',
  'Other',
];

export default function ReportScreen() {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Report submitted" showBack={false} />
        <StateView
          kind="empty"
          icon="ShieldCheck"
          title="Thank you for flagging this"
          message="Our Trust & Safety team will review this campaign. We may freeze it while we investigate."
          actionLabel="Done"
          onAction={() => goBack('/crowdfunding')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Report campaign" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.banner}>
            <ShieldAlert size={18} color={Colors.error} strokeWidth={2} />
            <Text style={styles.bannerText}>Reports are confidential. Help us keep Spotlight safe by telling us what's wrong.</Text>
          </View>

          <Text style={styles.label}>Why are you reporting this?</Text>
          {REASONS.map((r) => {
            const active = reason === r;
            return (
              <Pressable key={r} style={[styles.option, active && styles.optionActive]} onPress={() => setReason(r)} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <Text style={[styles.optionText, active && styles.optionTextActive]}>{r}</Text>
                {active && <Check size={18} color={Colors.secondary} strokeWidth={2.4} />}
              </Pressable>
            );
          })}

          <Text style={[styles.label, { marginTop: Spacing.lg }]}>Additional details (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Tell us more…"
            placeholderTextColor={Colors.outline}
            value={details}
            onChangeText={setDetails}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Submit report" onPress={() => setSubmitted(true)} disabled={!reason} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.sm },
  banner: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm },
  bannerText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: 4 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  optionActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLow },
  optionText: { ...Typography.bodyMd, color: Colors.onSurface },
  optionTextActive: { fontWeight: '600' as const },
  input: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, minHeight: 100, ...Typography.bodyMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
