import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { t } from '../i18n';
import type { Language } from '../types';

/**
 * SC-8 — a medical disclaimer that appears on EVERY triage screen. Renders the
 * "guidance only, not a diagnosis" line (also reinforces SC-1). Pull this into
 * every screen's layout alongside <EmergencyFab/>.
 */
export default function DisclaimerBar({ lang }: { lang: Language }) {
  const s = t(lang);
  return (
    <View style={styles.bar} accessibilityRole="alert" accessibilityLabel={s.disclaimer}>
      <Info size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
      <Text style={styles.text}>{s.disclaimer}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginHorizontal: Spacing.containerMargin,
  },
  text: { ...Typography.caption, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 15 },
});
