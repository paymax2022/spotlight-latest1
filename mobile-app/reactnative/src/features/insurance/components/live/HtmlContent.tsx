// ── Insurance (live) — provider HTML, rendered readably ─────────────────────
// `key_benefits` / `full_benefits` / `how_it_works` / `how_to_claim` arrive from
// MyCover as rich-text HTML. React Native cannot render markup, and dumping the
// string into a <Text> shows a person literal "<p>" tags.
//
// `live/html.ts` parses it into an allow-listed block list (every tag stripped,
// only structure kept); this draws those blocks with real components.

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { InsuranceColors } from '../../constants/insurance.constants';
import { parseHtmlBlocks } from '../../live/html';

export default function HtmlContent({
  html,
  /** Show this many blocks, then a "Read more" toggle. 0 = show everything. */
  collapseAfter = 0,
  emptyText,
}: {
  html: string;
  collapseAfter?: number;
  emptyText?: string;
}) {
  const blocks = useMemo(() => parseHtmlBlocks(html), [html]);
  const [expanded, setExpanded] = useState(false);

  if (blocks.length === 0) {
    return emptyText ? <Text style={styles.empty}>{emptyText}</Text> : null;
  }

  const collapsible = collapseAfter > 0 && blocks.length > collapseAfter;
  const shown = collapsible && !expanded ? blocks.slice(0, collapseAfter) : blocks;

  return (
    <View style={styles.wrap}>
      {shown.map((b, i) => {
        if (b.kind === 'heading') {
          return (
            <Text key={`${i}-h`} style={styles.heading}>
              {b.text}
            </Text>
          );
        }
        if (b.kind === 'bullet') {
          return (
            <View key={`${i}-b`} style={styles.bulletRow}>
              <View style={styles.dot} />
              <Text style={styles.bulletText}>{b.text}</Text>
            </View>
          );
        }
        return (
          <Text key={`${i}-p`} style={styles.paragraph}>
            {b.text}
          </Text>
        );
      })}

      {collapsible ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          style={styles.toggle}
        >
          <Text style={styles.toggleLabel}>{expanded ? 'Show less' : 'Read more'}</Text>
          {expanded ? (
            <ChevronUp size={16} color={InsuranceColors.brand} />
          ) : (
            <ChevronDown size={16} color={InsuranceColors.brand} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

/** Collapsible section wrapper used by the product detail screen. */
export function HtmlSection({
  title,
  html,
  defaultOpen = false,
  emptyText,
}: {
  title: string;
  html: string;
  defaultOpen?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasContent = useMemo(() => parseHtmlBlocks(html).length > 0, [html]);
  if (!hasContent && !emptyText) return null;

  return (
    <View style={styles.section}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.sectionHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.sectionTitle}>{title}</Text>
        {open ? (
          <ChevronUp size={18} color={Colors.onSurfaceVariant} />
        ) : (
          <ChevronDown size={18} color={Colors.onSurfaceVariant} />
        )}
      </Pressable>
      {open ? (
        <View style={styles.sectionBody}>
          <HtmlContent html={html} emptyText={emptyText} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  heading: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  paragraph: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 24 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  dot: {
    width: 6,
    height: 6,
    borderRadius: Radius.full,
    backgroundColor: InsuranceColors.ok,
    marginTop: 9,
  },
  bulletText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 24 },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant, fontStyle: 'italic' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.xs },
  toggleLabel: { ...Typography.labelMd, color: InsuranceColors.brand },

  section: {
    backgroundColor: InsuranceColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    overflow: 'hidden',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  sectionBody: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
});
