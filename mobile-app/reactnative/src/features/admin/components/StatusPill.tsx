// ── Paymax · Admin — StatusPill / StatPill ───────────────────────────────────
// Small status chip driven by the STATUS_STYLE maps in admin.constants. Design
// tokens only (mirrors the crypto status chips).

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface ChipStyle {
  label: string;
  fg: string;
  bg: string;
}

interface Props {
  /** Resolve a chip style from a STATUS_STYLE map, or pass `chip` directly. */
  chip?: ChipStyle;
  /** Convenience: a status key + the map to resolve it against. */
  status?: string;
  styleMap?: Record<string, ChipStyle>;
  /** Override the label (else uses the resolved chip's label). */
  label?: string;
}

const FALLBACK: ChipStyle = { label: '—', fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh };

export function StatusPill({ chip, status, styleMap, label }: Props) {
  const resolved = chip ?? (status && styleMap ? styleMap[status] : undefined) ?? FALLBACK;
  return (
    <View style={[styles.pill, { backgroundColor: resolved.bg }]}>
      <Text style={[styles.label, { color: resolved.fg }]} numberOfLines={1}>
        {label ?? resolved.label}
      </Text>
    </View>
  );
}

/** A neutral "stat" pill (label only, surface background) for inline metadata. */
export function StatPill({ text, tone }: { text: string; tone?: 'neutral' | 'info' }) {
  return (
    <View style={[styles.pill, tone === 'info' ? styles.info : styles.neutral]}>
      <Text style={[styles.label, tone === 'info' ? styles.infoText : styles.neutralText]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
  },
  label: { ...Typography.labelSm },
  neutral: { backgroundColor: Colors.surfaceContainerHigh },
  neutralText: { color: Colors.onSurfaceVariant },
  info: { backgroundColor: Colors.iconBgBlue },
  infoText: { color: Colors.secondary },
});

export default StatusPill;
