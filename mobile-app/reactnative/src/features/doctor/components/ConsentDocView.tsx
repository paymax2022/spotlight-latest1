import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LegalDocumentSection } from '@/types/doctor.onboarding';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  summary:       string;
  sections:      LegalDocumentSection[];
  bodyMarkdown?: string;   // fallback when sections is empty
  version:       string;
  effectiveDate: string;
}

// New component (Section A · entries 8–12): renders a versioned legal document's
// summary + structured sections inside a card. SectionCard is a single titled
// block; a legal doc has many headed sections plus a version/effective-date
// footer, so a dedicated renderer is justified. Non-interactive (the accept
// affordance lives on the host screen).
export default function ConsentDocView({ summary, sections, bodyMarkdown, version, effectiveDate }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.summary}>{summary}</Text>

      {sections.length > 0
        ? sections.map((s, i) => (
            <View key={`${s.heading}-${i}`} style={[styles.section, i > 0 && styles.sectionBorder]}>
              <Text style={styles.heading}>{s.heading}</Text>
              <Text style={styles.body}>{s.body}</Text>
            </View>
          ))
        : !!bodyMarkdown && (
            <View style={styles.section}>
              <Text style={styles.body}>{bodyMarkdown}</Text>
            </View>
          )}

      <View style={styles.footer}>
        <Text style={styles.meta}>Version {version}</Text>
        <Text style={styles.meta}>Effective {effectiveDate}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card:          { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  summary:       { ...Typography.bodyMd, color: Colors.onSurface, marginBottom: Spacing.md },
  section:       { paddingVertical: Spacing.sm, gap: Spacing.xs },
  sectionBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  heading:       { ...Typography.labelLg, color: Colors.onSurface },
  body:          { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  footer:        { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, marginTop: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  meta:          { ...Typography.caption, color: Colors.onSurfaceVariant },
});
