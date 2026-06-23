import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import type { FaqItem } from '@/types/doctor.batch7';

interface Props {
  item: FaqItem;
}

// New component: an expand/collapse FAQ row for the AA help centre. No existing
// component models a tap-to-expand question/answer; SectionCard is a static
// container and ProfileMenuItem navigates away rather than revealing inline body.
export default function FaqAccordion({ item }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      onPress={() => setOpen((o) => !o)}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={item.question}
    >
      <View style={styles.head}>
        <Text style={styles.question} numberOfLines={open ? undefined : 2}>{item.question}</Text>
        {open
          ? <ChevronUp size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          : <ChevronDown size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />}
      </View>
      {open && <Text style={styles.answer}>{item.answer}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:     { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.sm },
  head:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  question: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  answer:   { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
});
