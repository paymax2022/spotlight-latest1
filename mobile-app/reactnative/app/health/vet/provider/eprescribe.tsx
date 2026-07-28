import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Plus, Trash2, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import { useIssuePrescription } from '@/features/health/vet/hooks';

interface DraftItem {
  drugName: string;
  form: string;
  dosage: string;
  frequency: string;
  durationDays: string;
  quantity: string;
  pom: boolean;
  instructions: string;
}

const emptyItem = (): DraftItem => ({
  drugName: '',
  form: 'tablet',
  dosage: '',
  frequency: '',
  durationDays: '',
  quantity: '',
  pom: true,
  instructions: '',
});

export default function EprescribeScreen() {
  const { appointmentId, petId } = useLocalSearchParams<{ appointmentId?: string; petId: string }>();
  const issue = useIssuePrescription();
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const setItem = (i: number, k: keyof DraftItem, v: string | boolean) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const onIssue = () => {
    const valid = items.filter((it) => it.drugName.trim() && it.dosage.trim());
    if (valid.length === 0) {
      setError('Add at least one item with a drug name and dosage.');
      return;
    }
    setError('');
    issue.mutate(
      {
        appointmentId: appointmentId ?? 'appt',
        petId,
        notes: notes.trim() || undefined,
        items: valid.map((it) => ({
          drugName: it.drugName.trim(),
          form: it.form,
          dosage: it.dosage.trim(),
          frequency: it.frequency.trim() || 'As directed',
          durationDays: Number(it.durationDays) || 0,
          quantity: Number(it.quantity) || 0,
          pom: it.pom,
          instructions: it.instructions.trim() || undefined,
        })),
      },
      { onSuccess: () => setDone(true) },
    );
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="e-Prescription" />
        <StateView
          kind="empty"
          icon="ScrollText"
          title="Prescription issued"
          message="The e-prescription is in the owner’s records. They can send it to a verified pharmacy (dispense-once)."
          actionLabel="Back to requests"
          onAction={() => router.replace('/health/vet/provider/requests')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Issue e-prescription" subtitle="HL-3 · dispense-once" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.notice}>
          <ShieldAlert size={16} color={Colors.onWarning} strokeWidth={2} />
          <Text style={styles.noticeText}>
            POM items require pharmacist verification before dispensing. Controlled substances are excluded at MVP (HL-4).
          </Text>
        </View>

        {items.map((it, i) => (
          <View key={i} style={[styles.itemCard, shadow1]}>
            <View style={styles.itemHead}>
              <Text style={styles.itemTitle}>Item {i + 1}</Text>
              {items.length > 1 ? (
                <Pressable onPress={() => removeItem(i)} hitSlop={8}>
                  <Trash2 size={18} color={Colors.error} strokeWidth={2} />
                </Pressable>
              ) : null}
            </View>
            <TextInputField label="Drug name" placeholder="e.g. Apoquel" value={it.drugName} onChangeText={(t) => setItem(i, 'drugName', t)} />
            <View style={styles.row}>
              <View style={styles.col}><TextInputField label="Dosage" placeholder="16mg" value={it.dosage} onChangeText={(t) => setItem(i, 'dosage', t)} /></View>
              <View style={styles.col}><TextInputField label="Form" placeholder="tablet" value={it.form} onChangeText={(t) => setItem(i, 'form', t)} /></View>
            </View>
            <TextInputField label="Frequency" placeholder="Once daily" value={it.frequency} onChangeText={(t) => setItem(i, 'frequency', t)} />
            <View style={styles.row}>
              <View style={styles.col}><TextInputField label="Duration (days)" placeholder="14" value={it.durationDays} onChangeText={(t) => setItem(i, 'durationDays', t)} keyboardType="numeric" /></View>
              <View style={styles.col}><TextInputField label="Quantity" placeholder="14" value={it.quantity} onChangeText={(t) => setItem(i, 'quantity', t)} keyboardType="numeric" /></View>
            </View>
            <TextInputField label="Instructions" placeholder="e.g. Give with food" value={it.instructions} onChangeText={(t) => setItem(i, 'instructions', t)} />
            <View style={styles.pomRow}>
              <Text style={styles.pomLabel}>Prescription-only (POM)</Text>
              <Switch
                value={it.pom}
                onValueChange={(v) => setItem(i, 'pom', v)}
                trackColor={{ true: Colors.secondaryContainer, false: Colors.outlineVariant }}
                thumbColor={Colors.white}
              />
            </View>
          </View>
        ))}

        <Pressable style={styles.addBtn} onPress={addItem}>
          <Plus size={18} color={Colors.secondary} strokeWidth={2.2} />
          <Text style={styles.addText}>Add another item</Text>
        </Pressable>

        <TextInputField label="Notes" placeholder="Overall instructions" value={notes} onChangeText={setNotes} multiline />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Issue prescription" onPress={onIssue} loading={issue.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.iconBgGold, borderRadius: Radius.md, padding: Spacing.md },
  noticeText: { ...Typography.bodySm, color: Colors.onWarning, flex: 1, lineHeight: 18 },
  itemCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  itemTitle: { ...Typography.titleMd, fontSize: 15, color: Colors.onSurface },
  row: { flexDirection: 'row', gap: Spacing.sm },
  col: { flex: 1 },
  pomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.xs },
  pomLabel: { ...Typography.labelMd, color: Colors.onSurface },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderStyle: 'dashed', borderRadius: Radius.lg, paddingVertical: Spacing.md },
  addText: { ...Typography.labelMd, color: Colors.secondary },
  error: { ...Typography.labelSm, color: Colors.error },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
