import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { DISCLAIMER } from '../constants/ai.constants';

interface Props {
  text?: string;
  style?: ViewStyle;
  compact?: boolean;   // tighter footnote under an assistant bubble
}

/**
 * Standing compliance disclaimer footnoted on every assistant turn and on the
 * intro screen (docs/crypto/modules.md → Guardrails: "attach disclaimers").
 */
export default function DisclaimerNote({ text = DISCLAIMER, style, compact }: Props) {
  return (
    <View style={[styles.row, compact && styles.compact, style]}>
      <Info size={compact ? 12 : 14} color={Colors.onSurfaceVariant} strokeWidth={2} />
      <Text style={[styles.text, compact && styles.textCompact]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.sm,
  },
  compact: {
    backgroundColor: Colors.transparent,
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: Spacing.xs,
  },
  text: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 16 },
  textCompact: { ...Typography.caption, lineHeight: 14 },
});
