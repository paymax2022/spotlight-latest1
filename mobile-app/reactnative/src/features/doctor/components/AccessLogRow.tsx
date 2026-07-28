import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Activity } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';

interface Props {
  actor:   string;               // who accessed
  action:  string;               // verb ("viewed", "downloaded", "shared")
  section: string;               // record section / category
  role:    string;               // actor role
  at:      string;               // ISO datetime
  border?: boolean;              // top divider when stacked
}

// New component (W): a record access-log line (actor + action + section + role +
// time) for the medical-record access log. The patient hub previously inlined
// this row; extracting it lets the access-log screen and the per-patient index
// share one token-consistent row instead of duplicating the StyleSheet.
export default function AccessLogRow({ actor, action, section, role, at, border }: Props) {
  const when = new Date(at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <View style={[styles.row, border && styles.border]}>
      <Activity size={16} color={Colors.teal} strokeWidth={2} />
      <View style={styles.body}>
        <Text style={styles.text}>{actor} {action} {section.toLowerCase()}</Text>
        <Text style={styles.meta}>{role} · {when}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row:    { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm },
  border: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  body:   { flex: 1, gap: 2 },
  text:   { ...Typography.bodySm, color: Colors.onSurface },
  meta:   { ...Typography.caption, color: Colors.onSurfaceVariant },
});
