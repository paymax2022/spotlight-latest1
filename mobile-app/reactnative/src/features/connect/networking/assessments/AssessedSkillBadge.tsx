// Paymax Connect — Assessed skill badge (PN-5 + PN-12).
//
// PN-5  An ASSESSED skill is structurally + visually distinct from a self-reported
//       one. This component renders the assessed variant: a FILLED gold pill with a
//       BadgeCheck glyph. Self-reported skills use plain outline chips elsewhere
//       (e.g. DiscoveryChipRow) — never this treatment. Use <SelfReportedSkill/>
//       for the contrast case so the two can sit side by side.
// PN-12 The badge permanently records the question-bank version it was passed
//       against. `showVersion` surfaces it inline; the `detail` variant always
//       shows it (badge detail requirement).

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BadgeCheck, ShieldCheck, Tag } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface PillProps {
  skill: string;
  assessmentVersion: string;
  showVersion?: boolean;      // inline "· v3" suffix
}

/** Compact ASSESSED pill (PN-5) — filled gold, verified glyph. */
export function AssessedSkillBadge({ skill, assessmentVersion, showVersion = true }: PillProps) {
  return (
    <View style={styles.pill} accessibilityLabel={`Assessed skill ${skill}, version ${assessmentVersion}`}>
      <BadgeCheck size={14} color={Colors.onWarning} strokeWidth={2.4} />
      <Text style={styles.pillText}>{skill}</Text>
      {showVersion ? <Text style={styles.pillVersion}>· {assessmentVersion}</Text> : null}
    </View>
  );
}

/** Plain SELF-REPORTED chip (outline) — the deliberate visual contrast (PN-5). */
export function SelfReportedSkill({ skill }: { skill: string }) {
  return (
    <View style={styles.selfChip} accessibilityLabel={`Self-reported skill ${skill}`}>
      <Tag size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
      <Text style={styles.selfText}>{skill}</Text>
    </View>
  );
}

interface DetailProps {
  skill: string;
  title: string;
  domain: string;
  score?: number;
  assessmentVersion: string;   // ALWAYS shown here (PN-12 badge detail)
  issuedAt?: string;
}

/** Full badge card — the "badge detail" surface. Always shows the version. */
export function AssessedBadgeCard({ skill, title, domain, score, assessmentVersion, issuedAt }: DetailProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardIcon}>
        <ShieldCheck size={22} color={Colors.onWarning} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.cardHeadRow}>
          <Text style={styles.cardSkill} numberOfLines={1}>{skill}</Text>
          <View style={styles.assessedTag}>
            <BadgeCheck size={11} color={Colors.onWarning} strokeWidth={2.4} />
            <Text style={styles.assessedTagText}>Assessed</Text>
          </View>
        </View>
        <Text style={styles.cardMeta} numberOfLines={1}>{domain} · {title}</Text>
        <View style={styles.cardFooter}>
          {/* PN-12 — the immutable question-bank version this badge certifies. */}
          <View style={styles.versionChip}>
            <Text style={styles.versionText}>Assessment {assessmentVersion}</Text>
          </View>
          {typeof score === 'number' ? <Text style={styles.scoreText}>{score}%</Text> : null}
          {issuedAt ? <Text style={styles.dateText}>{new Date(issuedAt).toLocaleDateString()}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.iconBgGold,
    borderWidth: 1, borderColor: Colors.gold,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  pillText: { ...Typography.labelSm, color: Colors.onWarning, fontWeight: '700' },
  pillVersion: { ...Typography.caption, color: Colors.onWarning, fontVariant: ['tabular-nums'] },
  selfChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: Colors.outlineVariant,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  selfText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  card: {
    flexDirection: 'row', gap: Spacing.md, alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1.5, borderColor: Colors.gold,
    borderRadius: Radius.lg, padding: Spacing.md,
  },
  cardIcon: {
    width: 44, height: 44, borderRadius: Radius.full,
    backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center',
  },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardSkill: { ...Typography.titleMd, color: Colors.onSurface, flexShrink: 1 },
  assessedTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.iconBgGold, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
  },
  assessedTagText: { ...Typography.caption, color: Colors.onWarning, fontWeight: '700' },
  cardMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  versionChip: {
    backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
  },
  versionText: { ...Typography.caption, color: Colors.onSurface, fontWeight: '600', fontVariant: ['tabular-nums'] },
  scoreText: { ...Typography.labelSm, color: Colors.teal, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dateText: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
