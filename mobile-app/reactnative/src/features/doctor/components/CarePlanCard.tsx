import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Target, RefreshCw, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import StatusBadge from './StatusBadge';

interface Props {
  condition:      string;
  goal:           string;
  reviewEvery:    string;
  patientName:    string;
  milestoneCount: number;
  active:         boolean;
  onPress?:       () => void;
}

// New component: a long-term care-plan summary card (Section Q). EditableListCard
// is a single-line edit/remove row and SectionCard is an untitled wrapper;
// neither composes condition + goal + review cadence + milestone count + active
// badge, so this read card keeps the care-plan list legible.
export default function CarePlanCard({ condition, goal, reviewEvery, patientName, milestoneCount, active, onPress }: Props) {
  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Care plan for ${condition}`}
    >
      <View style={styles.head}>
        <Text style={styles.condition} numberOfLines={1}>{condition}</Text>
        <StatusBadge label={active ? 'Active' : 'Inactive'} tone={active ? 'success' : 'neutral'} />
      </View>
      <Text style={styles.patient} numberOfLines={1}>{patientName}</Text>
      <View style={styles.row}>
        <Target size={14} color={Colors.teal} strokeWidth={2} />
        <Text style={styles.meta} numberOfLines={1}>{goal}</Text>
      </View>
      <View style={styles.row}>
        <RefreshCw size={14} color={Colors.secondary} strokeWidth={2} />
        <Text style={styles.meta} numberOfLines={1}>Review every {reviewEvery} · {milestoneCount} milestone{milestoneCount === 1 ? '' : 's'}</Text>
      </View>
      {!!onPress && (
        <View style={styles.cta}>
          <Text style={styles.ctaText}>View plan</Text>
          <ChevronRight size={14} color={Colors.primary} strokeWidth={2.4} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:      { padding: Spacing.cardPadding, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.xs },
  head:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  condition: { ...Typography.titleMd, color: Colors.onSurface, flex: 1 },
  patient:   { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  row:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  meta:      { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  cta:       { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: Spacing.xs },
  ctaText:   { ...Typography.labelMd, color: Colors.primary },
});
