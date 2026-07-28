import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import type { TripPhase, VerificationStatus } from '../types/mobility.types';
import { PHASE_LABEL } from '../constants/mobility.constants';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_BG: Record<Tone, string> = {
  neutral: Colors.surfaceContainerHigh,
  info: 'rgba(0,81,213,0.10)',
  success: Colors.iconBgTeal,
  warning: Colors.iconBgGold,
  danger: Colors.errorContainer,
};
const TONE_FG: Record<Tone, string> = {
  neutral: Colors.onSurfaceVariant,
  info: Colors.secondary,
  success: Colors.tertiaryContainer,
  warning: Colors.onWarning,
  danger: Colors.error,
};

function phaseTone(phase: TripPhase): Tone {
  switch (phase) {
    case 'completed': return 'success';
    case 'pin_verified': return 'success';
    case 'in_progress': return 'info';
    case 'driver_assigned':
    case 'driver_arriving': return 'info';
    case 'fare_negotiating': return 'warning';
    case 'cancelled':
    case 'no_show':
    case 'safety_hold': return 'danger';
    default: return 'neutral';
  }
}

function verificationTone(status: VerificationStatus): Tone {
  switch (status) {
    case 'approved': return 'success';
    case 'rejected':
    case 'suspended': return 'danger';
    case 'submitted':
    case 'under_review': return 'warning';
    default: return 'neutral';
  }
}

const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  not_started: 'Not started',
  submitted: 'Submitted',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

interface Props {
  phase?: TripPhase;
  verification?: VerificationStatus;
  label?: string;
  tone?: Tone;
}

/** Pill status chip (DESIGN-Mobile → Chips & Badges). Derives tone/label from a
 *  trip phase or driver verification status, or accepts an explicit label+tone. */
export default function StatusBadge({ phase, verification, label, tone }: Props) {
  let text = label ?? '';
  let resolvedTone: Tone = tone ?? 'neutral';
  if (phase) { text = label ?? PHASE_LABEL[phase] ?? phase; resolvedTone = tone ?? phaseTone(phase); }
  else if (verification) { text = label ?? VERIFICATION_LABEL[verification]; resolvedTone = tone ?? verificationTone(verification); }

  return (
    <View style={[styles.badge, { backgroundColor: TONE_BG[resolvedTone] }]}>
      <Text style={[styles.text, { color: TONE_FG[resolvedTone] }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  text: { ...Typography.labelSm, fontWeight: '700' as const },
});
