import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Copy, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { copyText } from '../utils/clipboard';

interface Props {
  label: string;
  value: string;
  copyable?: boolean;
  emphasis?: boolean;
  valueColor?: string;
}

/** Generic label / value row for review & detail screens. Optional copy action. */
export default function SummaryRow({ label, value, copyable, emphasis, valueColor }: Props) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const ok = await copyText(value, label);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueWrap}>
        <Text
          style={[styles.value, emphasis && styles.emphasis, valueColor ? { color: valueColor } : null]}
          numberOfLines={2}
        >
          {value}
        </Text>
        {copyable ? (
          <Pressable onPress={onCopy} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Copy ${label}`}>
            {copied
              ? <Check size={15} color={Colors.teal} strokeWidth={2.5} />
              : <Copy size={15} color={Colors.secondary} strokeWidth={2} />}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: Spacing.md, paddingVertical: Spacing.sm,
  },
  label: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flexShrink: 0, maxWidth: '45%' },
  valueWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' },
  value: { ...Typography.labelMd, color: Colors.onSurface, textAlign: 'right', flexShrink: 1 },
  emphasis: { ...Typography.titleMd, color: Colors.onSurface },
});
