import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { APPT_STATUS_META, RX_STATUS_META, VACCINATION_STATUS_META, HOME_VISIT_STAGE_META } from '../constants';
import type { AppointmentStatus, RxStatus, VaccinationStatus, HomeVisitStage } from '../types';

/**
 * Multi-purpose status pill for the vet vertical. Pass exactly one of
 * appt / rx / vaccination / stage. Design-token coloured.
 */
export default function VetStatusPill({
  appt,
  rx,
  vaccination,
  stage,
}: {
  appt?: AppointmentStatus;
  rx?: RxStatus;
  vaccination?: VaccinationStatus;
  stage?: HomeVisitStage;
}) {
  const meta = appt
    ? APPT_STATUS_META[appt]
    : rx
    ? RX_STATUS_META[rx]
    : vaccination
    ? VACCINATION_STATUS_META[vaccination]
    : stage
    ? HOME_VISIT_STAGE_META[stage]
    : null;
  if (!meta) return null;

  return (
    <View style={[styles.pill, { backgroundColor: meta.bg }]} accessibilityRole="text">
      <Text style={[styles.text, { color: meta.color }]} numberOfLines={1}>
        {meta.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  text: { ...Typography.labelSm, fontWeight: '700' as const },
});
