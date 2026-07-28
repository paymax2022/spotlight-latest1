import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { CLAIM_STATE_LABEL, type ClaimState } from '../claims';

const TONE: Record<ClaimState, { fg: string; bg: string }> = {
  DRAFT:            { fg: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  FNOL_SUBMITTED:   { fg: Colors.secondary, bg: Colors.iconBgBlue },
  UNDER_ASSESSMENT: { fg: Colors.secondary, bg: Colors.iconBgBlue },
  NEEDS_MORE_INFO:  { fg: Colors.onWarning, bg: Colors.iconBgGold },
  APPROVED:         { fg: Colors.teal,      bg: Colors.iconBgTeal },
  PAYOUT_PENDING:   { fg: Colors.teal,      bg: Colors.iconBgTeal },
  SETTLED:          { fg: Colors.teal,      bg: Colors.iconBgTeal },
  REJECTED:         { fg: Colors.error,     bg: Colors.errorContainer },
};

/** Claim-state pill — reused across claims list / status / partner screens. */
export default function ClaimStateChip({ state }: { state: ClaimState }) {
  const tone = TONE[state] ?? TONE.DRAFT;
  return (
    <View style={[styles.chip, { backgroundColor: tone.bg }]}>
      <View style={[styles.dot, { backgroundColor: tone.fg }]} />
      <Text style={[styles.label, { color: tone.fg }]}>{CLAIM_STATE_LABEL[state] ?? state}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { ...Typography.labelSm, fontWeight: '700' as const },
});
