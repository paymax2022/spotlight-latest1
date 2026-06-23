import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import StatusBadge from './StatusBadge';
import type { StatusTone } from './StatusBadge';

interface Props {
  label:      string;
  rationale:  string;
  icon:       LucideIcon;
  required:   boolean;
  stateLabel?: string;   // current recorded decision, e.g. 'Granted'
  stateTone?:  StatusTone;
}

// New component (Section A · entries 13–16): the pre-prompt rationale block shown
// before triggering an OS permission dialog. Combines a large icon, a
// required/optional badge, the rationale copy and the current recorded state.
// No existing component composes this primer; reuses StatusBadge for the chips.
export default function PermissionPrimer({ label, rationale, icon: Icon, required, stateLabel, stateTone = 'neutral' }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconBox}>
        <Icon size={44} color={Colors.primary} strokeWidth={1.6} />
      </View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.badges}>
        <StatusBadge label={required ? 'Required' : 'Recommended'} tone={required ? 'brand' : 'neutral'} />
        {!!stateLabel && <StatusBadge label={stateLabel} tone={stateTone} />}
      </View>
      <Text style={styles.rationale}>{rationale}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:      { alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.lg },
  iconBox:   { width: 96, height: 96, borderRadius: Radius.xxl, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  label:     { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  badges:    { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.xs },
  rationale: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
