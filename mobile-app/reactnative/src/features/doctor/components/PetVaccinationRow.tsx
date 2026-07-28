import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Syringe, BellPlus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import StatusBadge from './StatusBadge';
import type { StatusTone } from './StatusBadge';
import { PET_VACCINATION_URGENCY_LABELS } from '@/features/doctor/constants';
import type { PetVaccinationRecommendation, PetVaccinationUrgency } from '@/types/doctor.batch5';

interface Props {
  recommendation: PetVaccinationRecommendation;
  dueText:        string;          // pre-formatted due date
  onSetReminder?: () => void;
}

// New component: a vaccination-recommendation row (vaccine + urgency badge +
// rationale + due date + optional set-reminder action). No barrel row pairs a
// syringe glyph with an urgency badge and reminder CTA, so this is justified.
const URGENCY_TONE: Record<PetVaccinationUrgency, StatusTone> = {
  overdue: 'danger', due_soon: 'warning', routine: 'success',
};

export default function PetVaccinationRow({ recommendation, dueText, onSetReminder }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.icon}>
        <Syringe size={16} color={Colors.teal} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.name} numberOfLines={1}>{recommendation.vaccineName}</Text>
          <StatusBadge label={PET_VACCINATION_URGENCY_LABELS[recommendation.urgency]} tone={URGENCY_TONE[recommendation.urgency]} />
        </View>
        <Text style={styles.rationale} numberOfLines={2}>{recommendation.rationale}</Text>
        <Text style={styles.due}>Due {dueText}</Text>
      </View>
      {!!onSetReminder && (
        <Pressable onPress={onSetReminder} hitSlop={8} style={styles.reminderBtn} accessibilityRole="button" accessibilityLabel={`Set reminder for ${recommendation.vaccineName}`}>
          <BellPlus size={18} color={Colors.primary} strokeWidth={2} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row:         { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  icon:        { width: 32, height: 32, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgTeal },
  body:        { flex: 1, gap: 2 },
  top:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name:        { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  rationale:   { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  due:         { ...Typography.caption, color: Colors.onSurfaceVariant },
  reminderBtn: { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryFixed },
});
