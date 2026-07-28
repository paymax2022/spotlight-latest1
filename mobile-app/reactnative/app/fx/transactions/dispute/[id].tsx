import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, ShieldQuestion } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useDisputeTransaction } from '@/features/fx/hooks/useFx';
import type { DisputeReason } from '@/features/fx/types/fx.types';

const REASONS: { value: DisputeReason; label: string; hint: string }[] = [
  { value: 'not_received', label: 'Recipient didn\'t get the money', hint: 'Payout shows paid but funds not received' },
  { value: 'wrong_amount', label: 'Wrong amount', hint: 'Amount sent or received is incorrect' },
  { value: 'wrong_rate', label: 'Wrong rate', hint: 'Executed rate differs from the quote' },
  { value: 'duplicate', label: 'Duplicate charge', hint: 'I was charged more than once' },
  { value: 'unauthorized', label: 'I didn\'t authorize this', hint: 'Transaction I don\'t recognize' },
  { value: 'other', label: 'Something else', hint: 'Describe the issue below' },
];

export default function DisputeScreen() {
  const { id, reference } = useLocalSearchParams<{ id: string; reference: string }>();
  const dispute = useDisputeTransaction();
  const [reason, setReason] = useState<DisputeReason | null>(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!reason) return;
    await dispute.mutateAsync({ transactionId: id, reference: reference ?? id, reason, note });
    setDone(true);
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <View style={styles.doneIcon}><CircleCheck size={52} color={Colors.tertiaryContainer} strokeWidth={2} /></View>
          <Text style={styles.doneTitle}>Dispute submitted</Text>
          <Text style={styles.doneSub}>Our team will review this transaction and update you within 1–3 business days. You can track it in support.</Text>
        </View>
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Done" onPress={() => router.dismissTo('/fx/transactions')} />
        </SafeAreaView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Dispute transaction" subtitle={reference} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.intro}>
            <ShieldQuestion size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.introText}>Tell us what went wrong. Disputes are reviewed against the ledger, both rates and the provider reference.</Text>
          </View>

          <Text style={styles.label}>Reason</Text>
          {REASONS.map((r) => {
            const sel = reason === r.value;
            return (
              <Pressable key={r.value} style={[styles.reason, sel && styles.reasonOn]} onPress={() => setReason(r.value)} accessibilityRole="radio" accessibilityState={{ selected: sel }}>
                <View style={[styles.radio, sel && styles.radioOn]}>{sel ? <View style={styles.radioDot} /> : null}</View>
                <View style={styles.flex}>
                  <Text style={styles.reasonLabel}>{r.label}</Text>
                  <Text style={styles.reasonHint}>{r.hint}</Text>
                </View>
              </Pressable>
            );
          })}

          <View style={styles.noteField}>
            <TextInputField label="Details (optional)" value={note} onChangeText={setNote} placeholder="Add anything that helps us investigate" multiline maxLength={500} />
          </View>
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Submit dispute" onPress={submit} loading={dispute.isPending} disabled={!reason} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin },
  intro: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.lg },
  introText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  reason: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.sm },
  reasonOn: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLow },
  radio: { width: 22, height: 22, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioOn: { borderColor: Colors.secondary },
  radioDot: { width: 11, height: 11, borderRadius: Radius.full, backgroundColor: Colors.secondary },
  reasonLabel: { ...Typography.labelLg, color: Colors.onSurface },
  reasonHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  noteField: { marginTop: Spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  doneIcon: { width: 96, height: 96, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  doneSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
