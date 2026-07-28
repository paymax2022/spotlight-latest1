import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LogIn, LogOut, BellRing, CircleDashed } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { VisitorColors } from '../constants/visitor.constants';
import { formatTime } from '../utils/visitorFormatters';
import type { CodeAttendance, CodeUsageMode } from '../types/visitor.types';

interface Props {
  attendance: CodeAttendance;
  usageMode: CodeUsageMode;
  compact?: boolean;
}

function derive(a: CodeAttendance) {
  if (a.inside) {
    return { label: 'Inside the estate', sub: a.lastInAt ? `Checked in at ${formatTime(a.lastInAt)}` : 'Checked in', color: VisitorColors.success, bg: VisitorColors.successBg, Icon: LogIn };
  }
  if (a.arrived) {
    return { label: 'Checked out', sub: a.lastOutAt ? `Left at ${formatTime(a.lastOutAt)}` : 'Visit complete', color: Colors.secondary, bg: Colors.iconBgBlue, Icon: LogOut };
  }
  if (a.lastQueriedAt) {
    return { label: 'At the gate', sub: `Being verified · ${formatTime(a.lastQueriedAt)}`, color: Colors.primary, bg: Colors.iconBgPurple, Icon: BellRing };
  }
  return { label: 'Not arrived yet', sub: 'No gate activity', color: Colors.onSurfaceVariant, bg: Colors.surfaceContainer, Icon: CircleDashed };
}

/** Live check-in/out status for a code (resident code screen + guard confirm). */
export default function AttendanceStatus({ attendance, usageMode, compact }: Props) {
  const s = derive(attendance);
  const { Icon } = s;
  const trips = attendance.checkIns > 1 || attendance.checkOuts > 0;

  return (
    <View style={[styles.card, compact && styles.compact, { backgroundColor: s.bg }]}>
      <View style={[styles.icon, { backgroundColor: Colors.white }]}>
        <Icon size={20} color={s.color} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: s.color }]}>{s.label}</Text>
        <Text style={styles.sub}>{s.sub}</Text>
      </View>
      {usageMode === 'entry_exit' && trips ? (
        <View style={styles.tripPill}>
          <Text style={styles.tripText}>{attendance.checkIns} in · {attendance.checkOuts} out</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderRadius: Radius.lg, padding: Spacing.md },
  compact: { padding: Spacing.sm + 2 },
  icon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  label: { ...Typography.labelLg },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  tripPill: { backgroundColor: Colors.white, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  tripText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
