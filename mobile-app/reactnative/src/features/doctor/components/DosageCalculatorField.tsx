import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Calculator } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { PET_DRUG_CATEGORY_LABELS } from '@/features/doctor/constants';
import type { PetDosageCalculation, PetDrugCategory } from '@/types/doctor.batch5';

interface Props {
  calc:          PetDosageCalculation;   // result of pure computePetDosage(drug, weightKg)
  category?:     PetDrugCategory;
}

// New component: renders a weight-based dosage result (low/high range + suggested
// midpoint + frequency) from the pure computePetDosage output. The existing
// inline dose box in prescription.tsx is screen-local; extracting it lets the
// dosage calculator sheet (T.4/T.5) reuse the exact same readout.
export default function DosageCalculatorField({ calc, category }: Props) {
  return (
    <View style={styles.box}>
      <Calculator size={18} color={Colors.primary} strokeWidth={2} />
      <View style={styles.body}>
        <Text style={styles.title}>Weight-based dose ({calc.weightKg} kg)</Text>
        <Text style={styles.range}>{calc.doseLowMg}-{calc.doseHighMg} mg range</Text>
        <Text style={styles.suggested}>Suggested {calc.suggestedMg} mg - {calc.frequency}</Text>
        {!!category && <Text style={styles.cat}>{PET_DRUG_CATEGORY_LABELS[category]}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box:       { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.primaryFixed },
  body:      { flex: 1, gap: 2 },
  title:     { ...Typography.labelSm, color: Colors.primary },
  range:     { ...Typography.bodySm, color: Colors.onSurface },
  suggested: { ...Typography.labelMd, color: Colors.onSurface },
  cat:       { ...Typography.caption, color: Colors.onSurfaceVariant },
});
