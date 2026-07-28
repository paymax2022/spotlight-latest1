import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { GraduationCap } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import PrimaryButton from '@/components/PrimaryButton';
import StatusBadge from './StatusBadge';
import type { StatusTone } from './StatusBadge';
import { TRAINING_STATUS_LABELS } from '@/features/doctor/constants';
import type { TrainingModule, TrainingStatus } from '@/types/doctor.batch7';

interface Props {
  module:      TrainingModule;
  onComplete?: () => void;
  completing?: boolean;
  border?:     boolean;
}

// New component: a mandatory-training module row with status pill, duration/due
// meta and a "Mark complete" CTA for the AB training screen. No existing row
// composes a training status + complete action.
const STATUS_TONE: Record<TrainingStatus, StatusTone> = {
  not_started: 'neutral',
  in_progress: 'info',
  completed:   'success',
  overdue:     'danger',
};

export default function TrainingModuleRow({ module, onComplete, completing, border }: Props) {
  const isDone = module.status === 'completed';
  const due = module.dueAt ? new Date(`${module.dueAt}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : undefined;
  return (
    <View style={[styles.row, border && styles.border]}>
      <View style={styles.iconBox}>
        <GraduationCap size={20} color={Colors.primary} strokeWidth={2} />
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.title} numberOfLines={2}>{module.title}</Text>
          <StatusBadge label={TRAINING_STATUS_LABELS[module.status]} tone={STATUS_TONE[module.status]} />
        </View>
        <Text style={styles.summary} numberOfLines={2}>{module.summary}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {module.required ? 'Required' : 'Optional'} · {module.durationMins} min
          {due && !isDone ? ` · due ${due}` : ''}
        </Text>
        {!isDone && onComplete && (
          <PrimaryButton label="Mark complete" onPress={onComplete} loading={completing} variant="secondary" fullWidth={false} style={styles.btn} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row:     { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  border:  { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  body:    { flex: 1, gap: 4 },
  top:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.sm },
  title:   { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  summary: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  meta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  btn:     { height: 40, paddingHorizontal: Spacing.md, marginTop: Spacing.xs, alignSelf: 'flex-start' },
});
