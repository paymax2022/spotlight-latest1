import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import { VOTING_RULES } from '../constants/voting.constants';

interface Props {
  /**
   * The CONTEST's actual admin-configured free-vote allowance. When provided,
   * overrides the generic "Free Voting" rule text (which otherwise quotes the
   * app-wide default) so a contest with its own free-vote count — including
   * zero, meaning free voting is off for that contest — is described
   * accurately instead of a number that may not apply to it.
   */
  freeVotesPerDay?: number;
  /**
   * Contest-specific rules/policies text an admin set for THIS contest
   * (public.contests.rules_text). When present, shown as its own section
   * ahead of the platform defaults below — it supplements them, it doesn't
   * replace them, since the defaults (refund policy, anti-fraud) still apply
   * to every contest regardless of what a contest-specific note says.
   */
  rulesText?: string;
}

export default function VotingRulesCard({ freeVotesPerDay, rulesText }: Props) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const sections = useMemo(() => {
    let base = VOTING_RULES;
    if (freeVotesPerDay !== undefined) {
      const freeVoteRule = freeVotesPerDay > 0
        ? `You get ${freeVotesPerDay} free vote${freeVotesPerDay === 1 ? '' : 's'} per day per contest.`
        : 'This contest does not offer free votes — all votes are paid.';
      base = base.map((section) => (
        section.title === 'Free Voting'
          ? { ...section, rules: [freeVoteRule, ...section.rules.slice(1)] }
          : section
      ));
    }
    if (rulesText?.trim()) {
      return [{ title: 'Contest Rules', rules: [rulesText.trim()] }, ...base];
    }
    return base;
  }, [freeVotesPerDay, rulesText]);

  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.header}>
        <ShieldCheck size={20} color={Colors.primary} strokeWidth={1.5} />
        <Text style={styles.title}>Voting Rules & Policies</Text>
      </View>

      {sections.map((section, i) => {
        const isOpen = openIdx === i;
        return (
          <View key={section.title} style={styles.section}>
            <Pressable
              onPress={() => setOpenIdx(isOpen ? null : i)}
              style={styles.sectionHeader}
            >
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {isOpen
                ? <ChevronUp size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                : <ChevronDown size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />}
            </Pressable>
            {isOpen && (
              <View style={styles.rulesList}>
                {section.rules.map((rule, j) => (
                  <View key={j} style={styles.ruleRow}>
                    <View style={styles.bullet} />
                    <Text style={styles.ruleText}>{rule}</Text>
                  </View>
                ))}
              </View>
            )}
            {i < sections.length - 1 && <View style={styles.divider} />}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius:    Radius.xl,
    borderWidth:     1,
    borderColor:     Colors.surfaceContainerHigh,
    overflow:        'hidden',
  },
  header:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, backgroundColor: Colors.surfaceContainerLow },
  title:         { ...Typography.titleMd, color: Colors.onSurface },
  section:       { paddingHorizontal: Spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  sectionTitle:  { ...Typography.labelMd, color: Colors.onSurface },
  rulesList:     { gap: Spacing.sm, paddingBottom: Spacing.md },
  ruleRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  bullet:        { width: 5, height: 5, borderRadius: 2.5, backgroundColor: Colors.primary, marginTop: 7, flexShrink: 0 },
  ruleText:      { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 20 },
  divider:       { height: 1, backgroundColor: Colors.surfaceContainerHigh },
});
