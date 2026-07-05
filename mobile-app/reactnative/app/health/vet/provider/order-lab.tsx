import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { TestTube, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useOrderLabForPet } from '@/features/health/vet/hooks';

const TESTS = [
  'Complete Blood Count (CBC)',
  'Biochemistry panel',
  'Urinalysis',
  'Faecal exam (parasites)',
  'Heartworm test',
  'Cytology',
  'Thyroid (T4)',
  'Culture & sensitivity',
];

export default function ProviderOrderLabScreen() {
  const { appointmentId, petId } = useLocalSearchParams<{ appointmentId?: string; petId: string }>();
  const orderLab = useOrderLabForPet();
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);

  const toggle = (t: string) => setSelected((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const onSubmit = () =>
    orderLab.mutate(
      { appointmentId: appointmentId ?? 'appt', petId, testNames: selected, note: note.trim() || undefined },
      { onSuccess: () => setDone(true) },
    );

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Lab order" />
        <StateView
          kind="empty"
          icon="FlaskConical"
          title="Lab order sent"
          message={`${selected.length} test${selected.length === 1 ? '' : 's'} ordered. The owner will book sample collection.`}
          actionLabel="Back to requests"
          onAction={() => router.replace('/health/vet/provider/requests')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Order lab test" subtitle="Select tests for this pet" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.list}>
          {TESTS.map((t) => {
            const active = selected.includes(t);
            return (
              <Pressable key={t} style={[styles.row, shadow1, active && styles.rowActive]} onPress={() => toggle(t)}>
                <View style={[styles.iconBox, active && styles.iconBoxActive]}>
                  <TestTube size={16} color={active ? Colors.white : Colors.teal} strokeWidth={2} />
                </View>
                <Text style={styles.rowText}>{t}</Text>
                {active ? <Check size={18} color={Colors.secondary} strokeWidth={2.4} /> : null}
              </Pressable>
            );
          })}
        </View>
        <TextInputField label="Clinical note for the lab" placeholder="Reason, suspected condition…" value={note} onChangeText={setNote} multiline />
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label={`Send order${selected.length ? ` (${selected.length})` : ''}`} onPress={onSubmit} disabled={selected.length === 0} loading={orderLab.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  list: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.transparent },
  rowActive: { borderColor: Colors.secondary },
  iconBox: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  iconBoxActive: { backgroundColor: Colors.secondary },
  rowText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
