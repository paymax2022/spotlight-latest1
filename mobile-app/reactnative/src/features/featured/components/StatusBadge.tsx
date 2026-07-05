import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { CampaignState } from '../types';
import { STATE_LABEL, STATE_TONE, type StatusTone } from '../utils';

const TONE_BG: Record<StatusTone, string> = {
  neutral: Colors.surfaceContainerHigh,
  info: 'rgba(0,81,213,0.10)',
  success: Colors.iconBgTeal,
  warning: Colors.iconBgGold,
  danger: Colors.errorContainer,
};
const TONE_FG: Record<StatusTone, string> = {
  neutral: Colors.onSurfaceVariant,
  info: Colors.secondary,
  success: Colors.tertiaryContainer,
  warning: Colors.onWarning,
  danger: Colors.error,
};

/** Campaign-state pill, styled to match FoodStatusBadge. */
export default function StatusBadge({ state, label }: { state: CampaignState; label?: string }) {
  const tone = STATE_TONE[state];
  return (
    <View style={[styles.badge, { backgroundColor: TONE_BG[tone] }]}>
      <Text style={[styles.text, { color: TONE_FG[tone] }]}>{label ?? STATE_LABEL[state]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  text: { ...Typography.labelSm },
});
