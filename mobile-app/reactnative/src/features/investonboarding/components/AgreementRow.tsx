import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ConsentCheckbox from './ConsentCheckbox';
import type { Agreement } from '../types/onboarding.types';

interface Props {
  agreement: Agreement;
  checked: boolean;
  onToggle: () => void;
}

/**
 * A single agreement: title + version + required tag, an expandable full-text
 * body, and an inline consent checkbox the user must tick to accept.
 */
export default function AgreementRow({ agreement, checked, onToggle }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{agreement.title}</Text>
          <Text style={styles.meta}>
            v{agreement.version} · {agreement.required ? 'Required' : 'Optional'}
          </Text>
        </View>
        <Pressable onPress={() => setExpanded((e) => !e)} hitSlop={8} accessibilityRole="button" accessibilityLabel={expanded ? 'Hide details' : 'Read details'}>
          {expanded
            ? <ChevronUp size={20} color={Colors.onSurfaceVariant} />
            : <ChevronDown size={20} color={Colors.onSurfaceVariant} />}
        </Pressable>
      </View>

      <Text style={styles.summary}>{agreement.summary}</Text>
      {expanded ? <Text style={styles.body}>{agreement.body}</Text> : null}

      <View style={styles.consent}>
        <ConsentCheckbox
          checked={checked}
          onToggle={onToggle}
          label={agreement.required
            ? `I have read and accept the ${agreement.title}.`
            : `Yes, send me ${agreement.title.replace(/\s*\(optional\)/i, '').toLowerCase()}.`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  titleWrap: { flex: 1, gap: 2 },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  summary: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  body: { ...Typography.bodySm, color: Colors.onSurface, lineHeight: 20 },
  consent: { marginTop: Spacing.xs },
});
