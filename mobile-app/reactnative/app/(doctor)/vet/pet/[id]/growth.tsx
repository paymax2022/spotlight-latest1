import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { TrendingUp, Plus, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, BarRow } from '@/features/doctor/components';
import { usePetGrowthHistory, useRecordPetGrowth } from '@/features/doctor/hooks';
import { PET_SPECIES_LABELS } from '@/features/doctor/constants';

// Pet growth / weight history (U.14) — weight timeseries rendered with BarRow,
// plus a record-new-point sheet.
export default function PetGrowthScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const petId = String(id);

  const { data: history, isLoading, isError, refetch } = usePetGrowthHistory(petId);
  const record = useRecordPetGrowth();

  const [open, setOpen] = useState(false);
  const [weight, setWeight] = useState('');
  const [ageMonths, setAgeMonths] = useState('');
  const [note, setNote] = useState('');

  const points = (history?.points ?? []).map((p) => ({
    label: new Date(p.date).toLocaleDateString('en-NG', { month: 'short', year: '2-digit' }),
    value: p.weightKg,
  }));

  const save = async () => {
    const w = Number(weight);
    const a = Number(ageMonths);
    if (!w || Number.isNaN(w)) { Alert.alert('Enter weight', 'Enter a valid weight in kg.'); return; }
    if (!a || Number.isNaN(a)) { Alert.alert('Enter age', 'Enter a valid age in months.'); return; }
    try {
      await record.mutateAsync({ petId, weightKg: w, ageMonths: a, note: note || undefined });
      setOpen(false); setWeight(''); setAgeMonths(''); setNote('');
      Alert.alert('Recorded', 'The growth point has been added.');
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Growth & Weight" />

      {isLoading && !history ? (
        <StateView variant="loading" label="Loading growth history" />
      ) : isError || !history ? (
        <StateView variant="error" message="We could not load growth history." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <Text style={styles.patientLine}>{history.petName} - {PET_SPECIES_LABELS[history.species]}</Text>

          {history.points.length === 0 ? (
            <StateView variant="empty" icon={TrendingUp} title="No weight data" message="Record the first weight to start the trend." />
          ) : (
            <SectionCard title="Weight trend (kg)" style={styles.card}>
              <BarRow points={points} formatValue={(v) => `${v} kg`} tint={Colors.teal} />
            </SectionCard>
          )}

          <SectionCard title="History" style={styles.card}>
            {history.points.map((p, i) => (
              <View key={p.date} style={[styles.row, i > 0 && styles.rowBorder]}>
                <View style={styles.rowBody}>
                  <Text style={styles.rowWeight}>{p.weightKg} kg</Text>
                  <Text style={styles.rowMeta}>{new Date(p.date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })} - {Math.floor(p.ageMonths / 12)}y {p.ageMonths % 12}m{p.note ? ` - ${p.note}` : ''}</Text>
                </View>
              </View>
            ))}
          </SectionCard>

          <Pressable style={styles.addBtn} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Record weight">
            <Plus size={18} color={Colors.primary} strokeWidth={2.4} />
            <Text style={styles.addText}>Record weight</Text>
          </Pressable>
        </ScrollView>
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Record weight</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          <Text style={styles.fieldLabel}>Weight (kg)</Text>
          <TextInput style={styles.input} placeholder="e.g. 12.4" placeholderTextColor={Colors.outline} keyboardType="decimal-pad" value={weight} onChangeText={setWeight} />
          <Text style={styles.fieldLabel}>Age (months)</Text>
          <TextInput style={styles.input} placeholder="e.g. 18" placeholderTextColor={Colors.outline} keyboardType="number-pad" value={ageMonths} onChangeText={setAgeMonths} />
          <Text style={styles.fieldLabel}>Note (optional)</Text>
          <TextInput style={styles.input} placeholder="e.g. Healthy weight gain" placeholderTextColor={Colors.outline} value={note} onChangeText={setNote} />
          <PrimaryButton label="Save" onPress={save} loading={record.isPending} style={styles.btn} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  patientLine: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  card:        { marginBottom: Spacing.md },
  row:         { paddingVertical: Spacing.sm },
  rowBody:     { gap: 2 },
  rowWeight:   { ...Typography.labelLg, color: Colors.onSurface },
  rowMeta:     { ...Typography.caption, color: Colors.onSurfaceVariant },
  rowBorder:   { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  addBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  addText:     { ...Typography.labelMd, color: Colors.primary },
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  fieldLabel:  { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm, marginBottom: Spacing.xs },
  input:       { height: 48, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, backgroundColor: Colors.surfaceContainerLow, ...Typography.bodyMd, color: Colors.onSurface },
  btn:         { marginTop: Spacing.md },
});
