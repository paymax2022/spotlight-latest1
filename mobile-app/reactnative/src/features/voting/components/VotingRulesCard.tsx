import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { shadow1 } from '@/constants/shadows';
import { VOTING_RULES } from '../constants/voting.constants';

export default function VotingRulesCard() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.header}>
        <ShieldCheck size={20} color={Colors.primary} strokeWidth={1.5} />
        <Text style={styles.title}>Voting Rules & Policies</Text>
      </View>

      {VOTING_RULES.map((section, i) => {
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
            {i < VOTING_RULES.length - 1 && <View style={styles.divider} />}
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
