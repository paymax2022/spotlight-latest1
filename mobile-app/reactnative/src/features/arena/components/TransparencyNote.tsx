import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Scale } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

/**
 * NDC-1 transparency note. Surfaced wherever Support money or Play-Along
 * engagement appears so the user always understands it does not affect the crown.
 * (Reuses the PrivacyNote visual language from kycverify for consistency.)
 */
export default function TransparencyNote({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.box}>
      <Scale size={16} color={Colors.secondary} strokeWidth={2} />
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.iconBgBlue,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  text: { ...Typography.labelSm, color: Colors.onSurface, flex: 1, lineHeight: 18 },
});
