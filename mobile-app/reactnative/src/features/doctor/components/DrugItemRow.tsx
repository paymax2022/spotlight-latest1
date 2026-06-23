import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import { DRUG_CATALOGUE, ROUTE_OPTIONS, FREQUENCY_OPTIONS, DURATION_OPTIONS } from '@/features/doctor/constants';
import type { PrescriptionDrugItem } from '@/types/doctor';

interface Props {
  index:    number;
  item:     PrescriptionDrugItem;
  onChange: (index: number, item: PrescriptionDrugItem) => void;
  onRemove: (index: number) => void;
  canRemove: boolean;
}

const DRUG_NAMES = DRUG_CATALOGUE.map((d) => d.name);

// New component: a single editable prescription drug row composed of SelectField
// + TextInputField. The composition (drug + dosage + route + frequency + duration
// + notes + remove) is specific to the prescription builder, so this row is new
// even though it reuses the shared form fields internally.
export default function DrugItemRow({ index, item, onChange, onRemove, canRemove }: Props) {
  const dosageOptions = DRUG_CATALOGUE.find((d) => d.name === item.name)?.commonDosages ?? [];
  const set = (patch: Partial<PrescriptionDrugItem>) => onChange(index, { ...item, ...patch });

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.heading}>Drug {index + 1}</Text>
        {canRemove && (
          <Pressable
            onPress={() => onRemove(index)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove drug ${index + 1}`}
            style={styles.removeBtn}
          >
            <Trash2 size={18} color={Colors.error} strokeWidth={2} />
          </Pressable>
        )}
      </View>

      <SelectField label="Medication" placeholder="Select drug" value={item.name || undefined} options={DRUG_NAMES} onChange={(name) => set({ name, dosage: '' })} />

      <View style={styles.row}>
        <View style={styles.half}>
          <SelectField label="Dosage" placeholder="e.g. 500mg" value={item.dosage || undefined} options={dosageOptions.length ? dosageOptions : ['Custom']} onChange={(dosage) => set({ dosage })} searchable={false} />
        </View>
        <View style={styles.half}>
          <SelectField label="Route" value={item.route || undefined} options={ROUTE_OPTIONS} onChange={(route) => set({ route })} searchable={false} />
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.half}>
          <SelectField label="Frequency" value={item.frequency || undefined} options={FREQUENCY_OPTIONS} onChange={(frequency) => set({ frequency })} searchable={false} />
        </View>
        <View style={styles.half}>
          <SelectField label="Duration" value={item.duration || undefined} options={DURATION_OPTIONS} onChange={(duration) => set({ duration })} searchable={false} />
        </View>
      </View>

      <TextInputField label="Notes (optional)" placeholder="e.g. Take after meals" value={item.notes ?? ''} onChangeText={(notes) => set({ notes })} />
    </View>
  );
}

const styles = StyleSheet.create({
  card:      { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  heading:   { ...Typography.titleMd, color: Colors.onSurface },
  removeBtn: { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.errorContainer },
  row:       { flexDirection: 'row', gap: Spacing.sm },
  half:      { flex: 1 },
});
