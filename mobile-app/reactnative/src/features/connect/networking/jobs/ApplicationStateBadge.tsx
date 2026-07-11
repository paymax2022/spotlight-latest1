import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  FileText,
  Send,
  Clock,
  AlertCircle,
  Star,
  CalendarClock,
  Award,
  CheckCircle2,
  XCircle,
  Undo2,
  type LucideIcon,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { ApplicationState } from './types';

interface StateMeta {
  label: string;
  fg: string;   // text + icon color
  bg: string;   // pill background
  Icon: LucideIcon;
}

// Mirrors the backend application FSM. Colors are grouped by intent:
// blue = in-motion, purple = advancing, gold = attention/celebrate,
// teal = success, muted = terminal-neutral, error = action required.
export const APPLICATION_STATE_META: Record<ApplicationState, StateMeta> = {
  draft:        { label: 'Draft',        fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh, Icon: FileText },
  submitted:    { label: 'Submitted',    fg: Colors.secondary,        bg: Colors.iconBgBlue,           Icon: Send },
  under_review: { label: 'Under review', fg: Colors.onWarning,        bg: Colors.iconBgGold,           Icon: Clock },
  needs_info:   { label: 'Action needed', fg: Colors.error,           bg: Colors.errorContainer,       Icon: AlertCircle },
  shortlisted:  { label: 'Shortlisted',  fg: Colors.primary,          bg: Colors.iconBgPurple,         Icon: Star },
  interview:    { label: 'Interview',    fg: Colors.secondary,        bg: Colors.iconBgBlue,           Icon: CalendarClock },
  offered:      { label: 'Offer',        fg: Colors.onWarning,        bg: Colors.iconBgGold,           Icon: Award },
  hired:        { label: 'Hired',        fg: Colors.teal,             bg: Colors.iconBgTeal,           Icon: CheckCircle2 },
  rejected:     { label: 'Not selected', fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh, Icon: XCircle },
  withdrawn:    { label: 'Withdrawn',    fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh, Icon: Undo2 },
};

/** Application FSM status pill (JB-04). */
export default function ApplicationStateBadge({ state }: { state: ApplicationState }) {
  const meta = APPLICATION_STATE_META[state] ?? APPLICATION_STATE_META.submitted;
  const Icon = meta.Icon;
  return (
    <View style={[styles.badge, { backgroundColor: meta.bg }]}>
      <Icon size={13} color={meta.fg} strokeWidth={2.4} />
      <Text style={[styles.text, { color: meta.fg }]}>{meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  text: { ...Typography.caption, fontWeight: '700' },
});
