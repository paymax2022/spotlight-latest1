import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Clock, AlertTriangle, Timer } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { ConsultCountdown } from '@/types/doctor.batch1';

interface Props {
  countdown: ConsultCountdown;
}

// New component: a consultation countdown banner (Section F F15/F16, also reused
// on the dashboard active-consult / waiting-room context). Renders the
// `computeConsultCountdown` result with three tones: starting-soon (info),
// overdue (warning) and doctor-late (critical). Nothing existing renders a
// time-to-slot countdown, so this is genuinely new.
export default function CountdownBanner({ countdown }: Props) {
  const { isDoctorLate, isOverdue, isStartingSoon, label } = countdown;

  const tone = isDoctorLate ? 'late' : isOverdue ? 'overdue' : isStartingSoon ? 'soon' : 'idle';
  const cfg = {
    late:    { fg: Colors.error,     bg: Colors.errorContainer,     Icon: AlertTriangle, note: 'You are running late — start the consult now.' },
    overdue: { fg: Colors.primary,   bg: Colors.iconBgPurple,       Icon: Timer,         note: 'The slot time has passed.' },
    soon:    { fg: Colors.secondary, bg: Colors.iconBgBlue,         Icon: Clock,         note: 'Your consult is starting soon.' },
    idle:    { fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerLow, Icon: Clock, note: 'Upcoming consultation.' },
  }[tone];
  const Icon = cfg.Icon;

  return (
    <View style={[styles.banner, { backgroundColor: cfg.bg }]}>
      <Icon size={20} color={cfg.fg} strokeWidth={2} />
      <View style={styles.body}>
        <Text style={[styles.label, { color: cfg.fg }]} numberOfLines={1}>{label}</Text>
        <Text style={styles.note} numberOfLines={2}>{cfg.note}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg },
  body:   { flex: 1, gap: 2 },
  label:  { ...Typography.labelLg },
  note:   { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
