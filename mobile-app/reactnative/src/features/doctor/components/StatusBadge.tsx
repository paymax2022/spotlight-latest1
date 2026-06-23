import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

interface Props {
  label: string;
  tone?: StatusTone;
}

// New component: a generic status pill for the Phase 2 status unions
// (pharmacy / refill / referral / claim / follow-up / licence / alert).
// ConsultStatusBadge is typed strictly to ConsultStatus and renders a dot, so a
// tone-driven badge is justified rather than overloading that component.
const TONE: Record<StatusTone, { fg: string; bg: string }> = {
  neutral: { fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerLow },
  info:    { fg: Colors.secondary,        bg: Colors.iconBgBlue },
  success: { fg: Colors.teal,             bg: Colors.iconBgTeal },
  warning: { fg: Colors.secondary,        bg: Colors.iconBgBlue },
  danger:  { fg: Colors.error,            bg: Colors.errorContainer },
  brand:   { fg: Colors.primary,          bg: Colors.iconBgPurple },
};

export default function StatusBadge({ label, tone = 'neutral' }: Props) {
  const c = TONE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.label, { color: c.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { height: 26, paddingHorizontal: 10, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  label: { ...Typography.labelSm, fontWeight: '700' },
});
