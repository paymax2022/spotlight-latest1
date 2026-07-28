import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { HealthColors, EMERGENCY_DISCLAIMER } from '../constants/health.constants';

/**
 * Emergency-safety disclaimer (HL-11): tele-consult is not a substitute for
 * emergency care. Shown in the consult lobby + room and any urgent-care flow.
 */
export default function EmergencyBanner({ message }: { message?: string }) {
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <TriangleAlert size={18} color={HealthColors.warnText} strokeWidth={2.2} />
      <Text style={styles.text}>{message ?? EMERGENCY_DISCLAIMER}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(234,179,8,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(234,179,8,0.35)',
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  text: { ...Typography.labelSm, color: HealthColors.warnText, flex: 1, lineHeight: 18 },
});
