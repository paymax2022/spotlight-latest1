import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';

interface Props {
  title?: string;
  body: string;            // long disclosure text (paragraphs separated by \n\n)
  confirmLabel?: string;
  /** Optional checkbox confirmation copy; when set, both scroll + check are required. */
  checkLabel?: string;
  onAccept: () => void;
  accepting?: boolean;
}

/**
 * Scroll-gated risk acknowledgement. The accept button stays disabled until the
 * user scrolls to the bottom of the disclosure (and ticks the box if provided).
 * Used for the master disclosure (activation) and per-offer e-sign step.
 */
export default function RiskAckSheet({ title, body, confirmLabel = 'I have read and understand', checkLabel, onAccept, accepting }: Props) {
  const [scrolledEnd, setScrolledEnd] = useState(false);
  const [checked, setChecked] = useState(false);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 24) setScrolledEnd(true);
  };

  const canAccept = scrolledEnd && (!checkLabel || checked);
  const paragraphs = body.split('\n\n');

  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onScroll={onScroll}
        scrollEventThrottle={64}
        showsVerticalScrollIndicator
      >
        {paragraphs.map((p, i) => (
          <Text key={i} style={styles.para}>{p}</Text>
        ))}
        <Text style={styles.endMark}>— End of disclosure —</Text>
      </ScrollView>

      {!scrolledEnd ? (
        <Text style={styles.hint}>Scroll to the end to continue.</Text>
      ) : null}

      {checkLabel ? (
        <Pressable style={styles.checkRow} onPress={() => setChecked((c) => !c)} disabled={!scrolledEnd}>
          <View style={[styles.checkbox, checked && styles.checkboxOn, !scrolledEnd && styles.checkboxDim]}>
            {checked ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
          </View>
          <Text style={styles.checkLabel}>{checkLabel}</Text>
        </Pressable>
      ) : null}

      <PrimaryButton label={confirmLabel} onPress={onAccept} disabled={!canAccept} loading={accepting} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.md, flex: 1 },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  scroll: { flex: 1, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  scrollContent: { padding: Spacing.md, gap: Spacing.md },
  para: { ...Typography.bodySm, color: Colors.onSurface, lineHeight: 21 },
  endMark: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.sm },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkboxDim: { opacity: 0.4 },
  checkLabel: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
});
