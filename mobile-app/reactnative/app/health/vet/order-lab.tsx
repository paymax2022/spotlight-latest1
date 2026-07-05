import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { TestTube, Check, FlaskConical, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import { useOrderLabForPet, usePet } from '@/features/health/vet/hooks';

const PET_TESTS = [
  'Complete Blood Count (CBC)',
  'Biochemistry panel',
  'Urinalysis',
  'Faecal exam (parasites)',
  'Heartworm test',
  'Skin scrape / cytology',
  'Thyroid (T4)',
];

export default function OrderLabScreen() {
  const { petId, appointmentId } = useLocalSearchParams<{ petId: string; appointmentId?: string }>();
  const { data: pet } = usePet(petId);
  const orderLab = useOrderLabForPet();
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);

  const toggle = (t: string) =>
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const onSubmit = () => {
    orderLab.mutate(
      { appointmentId: appointmentId ?? 'appt', petId, testNames: selected, note: note.trim() || undefined },
      { onSuccess: () => setDone(true) },
    );
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Lab order" />
        <StateView
          kind="empty"
          icon="FlaskConical"
          title="Lab order created"
          message={`We’ve handed off ${selected.length} test${selected.length === 1 ? '' : 's'} to the lab. Book collection in the Lab section.`}
          actionLabel="Go to Lab"
          onAction={() => router.replace('/health/lab')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Order pet lab test" subtitle={pet?.name ? `For ${pet.name}` : undefined} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.trust}>
          <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.trustText}>Lab tests are run by MLSCN-verified labs. Results return to your pet’s consented records.</Text>
        </View>

        <Text style={styles.sectionTitle}>Select tests</Text>
        <View style={styles.list}>
          {PET_TESTS.map((t) => {
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

        <TextInputField label="Note to the lab (optional)" placeholder="Clinical context, fasting, etc." value={note} onChangeText={setNote} multiline />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={`Create lab order${selected.length ? ` (${selected.length})` : ''}`}
          onPress={onSubmit}
          disabled={selected.length === 0}
          loading={orderLab.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  trust: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  trustText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  list: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.transparent },
  rowActive: { borderColor: Colors.secondary },
  iconBox: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  iconBoxActive: { backgroundColor: Colors.secondary },
  rowText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
