import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { CREATOR_DISCLAIMER } from '../constants/spotlight.constants';

interface Props {
  text?: string;   // override default creator-disclaimer copy where needed
}

/**
 * Education-first disclaimer banner. Defaults to the creator no-advice line
 * ("Educational content, not investment advice; creators are not recommending
 * securities") — surfaced wherever creator finance content / rewards appear.
 */
export default function CreatorDisclaimer({ text = CREATOR_DISCLAIMER }: Props) {
  return (
    <View style={styles.wrap} accessibilityRole="text">
      <Info size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
  },
  text: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 17 },
});
