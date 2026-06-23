import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ShieldAlert, AlertTriangle, Info } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import StatusBadge from './StatusBadge';
import type { StatusTone } from './StatusBadge';
import { PET_RX_WARNING_LABELS, PET_WARNING_SEVERITY_LABELS } from '@/features/doctor/constants';
import type { PetRxWarning, PetWarningSeverity } from '@/types/doctor.batch5';

interface Props {
  warning: PetRxWarning;
}

// New component: a single pet-Rx safety warning row driven by the PetRxWarning
// union (kind + severity + drug + message). SeverityFinding's prop shape is built
// for AI findings (kind/severity/detail/drugs/recommendation) and does not map to
// the warning union cleanly, so this small kind-aware chip keeps the Rx preview
// warnings visible and tokenised.
const SEVERITY_TONE: Record<PetWarningSeverity, StatusTone> = {
  info: 'info', caution: 'warning', danger: 'danger',
};

const SEVERITY_ICON: Record<PetWarningSeverity, LucideIcon> = {
  info: Info, caution: AlertTriangle, danger: ShieldAlert,
};

export default function PetRxWarningChip({ warning }: Props) {
  const Icon = SEVERITY_ICON[warning.severity];
  const danger = warning.severity === 'danger';
  return (
    <View style={[styles.card, danger && styles.cardDanger]}>
      <Icon size={18} color={danger ? Colors.error : Colors.primary} strokeWidth={2} />
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.kind}>{PET_RX_WARNING_LABELS[warning.kind]}</Text>
          <StatusBadge label={PET_WARNING_SEVERITY_LABELS[warning.severity]} tone={SEVERITY_TONE[warning.severity]} />
        </View>
        <Text style={styles.drug}>{warning.drugName}</Text>
        <Text style={styles.msg}>{warning.message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card:       { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  cardDanger: { borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  body:       { flex: 1, gap: 2 },
  top:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  kind:       { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '700', textTransform: 'uppercase' },
  drug:       { ...Typography.labelMd, color: Colors.onSurface },
  msg:        { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
