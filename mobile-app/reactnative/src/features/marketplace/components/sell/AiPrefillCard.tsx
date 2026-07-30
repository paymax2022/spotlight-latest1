// ── Sell — AI prefill suggestion card (Smart Composer, screen 11) ────────────
// Shows the mocked vision-model guess as an *editable suggestion* the seller
// confirms rather than a blank form. Loading = skeleton row (not a spinner on
// content). Failure is handled upstream: the composer simply doesn't render this
// card and shows the blank form (graceful AI degradation, per spec §11).
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Sparkles, Check, Pencil } from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors } from '@/features/marketplace';
import type { AiPrefillResult } from '@/features/marketplace/api/sell.api';

interface Props {
  loading: boolean;
  result: AiPrefillResult | null;
  onAccept: () => void;
  onDismiss: () => void;
}

export default function AiPrefillCard({ loading, result, onAccept, onDismiss }: Props) {
  if (loading) {
    return (
      <View style={[styles.wrap, styles.loadingWrap]}>
        <Sparkles size={16} color={MarketColors.brand} />
        <View style={styles.skeletonCol}>
          <View style={[styles.skelBar, { width: '70%' }]} />
          <View style={[styles.skelBar, { width: '40%' }]} />
        </View>
      </View>
    );
  }

  if (!result || !result.categoryId) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Sparkles size={16} color={MarketColors.brand} />
        <Text style={styles.headText}>
          We think this is a <Text style={styles.headBold}>{result.categoryName}</Text>
          {result.suggestedTitle ? <Text> — “{result.suggestedTitle}”</Text> : null}
        </Text>
      </View>
      <Text style={styles.hint}>Suggestions you can accept or edit — nothing is final until you publish.</Text>
      <View style={styles.actions}>
        <Pressable style={styles.acceptBtn} onPress={onAccept} accessibilityRole="button" accessibilityLabel="Use AI suggestion">
          <Check size={14} color="#FFFFFF" />
          <Text style={styles.acceptText}>Use suggestion</Text>
        </Pressable>
        <Pressable style={styles.editBtn} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Fill the form myself">
          <Pencil size={14} color={MarketColors.brand} />
          <Text style={styles.editText}>I'll fill it in</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: MarketColors.okBg, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  loadingWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  skeletonCol: { flex: 1, gap: 6 },
  skelBar: { height: 10, borderRadius: 5, backgroundColor: MarketColors.surfaceAlt },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  headText: { ...Typography.bodySm, color: MarketColors.text, flex: 1 },
  headBold: { fontWeight: '700' },
  hint: { ...Typography.labelSm, color: MarketColors.muted },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  acceptBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: MarketColors.brand, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  acceptText: { ...Typography.labelSm, color: '#FFFFFF', fontWeight: '700' },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: MarketColors.brand, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  editText: { ...Typography.labelSm, color: MarketColors.brand, fontWeight: '700' },
});
