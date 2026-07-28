import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LogIn, LogOut, Ban, UserPlus, Siren, BellRing, CloudUpload } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { VisitorColors } from '../constants/visitor.constants';
import { relativeTime } from '../utils/visitorFormatters';
import type { VisitAction, VisitEvent } from '../types/visitor.types';

const ACTION_META: Record<VisitAction, { label: string; color: string; bg: string; Icon: typeof LogIn }> = {
  check_in:  { label: 'Checked in',  color: VisitorColors.success, bg: VisitorColors.successBg, Icon: LogIn },
  check_out: { label: 'Checked out', color: Colors.secondary,      bg: Colors.iconBgBlue,       Icon: LogOut },
  deny:      { label: 'Denied',      color: Colors.error,          bg: Colors.errorContainer,   Icon: Ban },
  walk_in:   { label: 'Walk-in',     color: VisitorColors.warning, bg: VisitorColors.warningBg, Icon: UserPlus },
  arrival:   { label: 'Arrived',     color: Colors.primary,        bg: Colors.iconBgPurple,     Icon: BellRing },
  emergency: { label: 'Emergency',   color: Colors.error,          bg: Colors.errorContainer,   Icon: Siren },
};

/** A single gate-log / visitor-history row (VM-144 / VM-214). */
export default function VisitEventRow({ event }: { event: VisitEvent }) {
  const meta = ACTION_META[event.action];
  const { Icon } = meta;

  return (
    <View style={styles.row}>
      <View style={[styles.iconBox, { backgroundColor: meta.bg }]}>
        <Icon size={18} color={meta.color} strokeWidth={1.8} />
      </View>

      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={1}>{event.visitorName}</Text>
          <Text style={styles.time}>{relativeTime(event.timestamp)}</Text>
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          <Text style={{ color: meta.color }}>{meta.label}</Text>
          {`  ·  ${event.unitLabel}`}
          {event.reason ? `  ·  ${event.reason}` : ''}
        </Text>
      </View>

      {event.syncStatus === 'pending' ? (
        <View style={styles.pendingBadge} accessibilityLabel="Pending sync">
          <CloudUpload size={12} color={VisitorColors.warning} strokeWidth={2} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  time: { ...Typography.labelSm, color: Colors.outline },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  pendingBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VisitorColors.warningBg,
  },
});
