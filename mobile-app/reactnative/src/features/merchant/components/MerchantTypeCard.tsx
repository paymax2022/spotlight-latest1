import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Check, ChevronRight, Clock3, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import type { MerchantType } from '@/types/merchant';

interface Props {
  type:    MerchantType;
  onPress: () => void;
}

// New component: the rich merchant-type selection card (FR-6) — icon, name,
// description, a requirements checklist, KYC tier and expected review time.
// FeaturedServiceCard is a single-line icon/title/subtitle row with no
// requirements list or meta footer, so this richer card is justified. Built
// entirely from existing tokens + shadow1, matching the card shape language.
export default function MerchantTypeCard({ type, onPress }: Props) {
  const IconComponent = (Icons as unknown as Record<string, Icons.LucideIcon>)[type.icon] ?? Icons.Store;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Apply as ${type.name}`}
    >
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <IconComponent size={22} color={Colors.primary} strokeWidth={1.8} />
        </View>
        <View style={styles.headBody}>
          <Text style={styles.name} numberOfLines={1}>{type.name}</Text>
          <Text style={styles.desc} numberOfLines={2}>{type.description}</Text>
        </View>
        <ChevronRight size={18} color={Colors.outline} strokeWidth={1.8} />
      </View>

      <View style={styles.reqs}>
        {type.requirementsSummary.map((req) => (
          <View key={req} style={styles.reqRow}>
            <Check size={14} color={Colors.teal} strokeWidth={2.4} />
            <Text style={styles.reqText} numberOfLines={1}>{req}</Text>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <View style={styles.metaPill}>
          <Clock3 size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.metaText}>{type.expectedReviewLabel}</Text>
        </View>
        <View style={styles.metaPill}>
          <ShieldCheck size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.metaText}>KYC Tier {type.requiredKycTier}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card:     { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md, gap: Spacing.md },
  pressed:  { opacity: 0.85 },
  header:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconBox:  { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  headBody: { flex: 1, gap: 2 },
  name:     { ...Typography.titleMd, color: Colors.onSurface },
  desc:     { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  reqs:     { gap: Spacing.xs },
  reqRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  reqText:  { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  footer:   { flexDirection: 'row', gap: Spacing.sm },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
