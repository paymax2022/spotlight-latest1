// ── Marketplace — DealStageChip ──────────────────────────────────────────────
// The per-conversation deal-stage chip (Chat inbox). Colour-codes by stage so a
// buyer/seller can read where a conversation stands without opening it.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { MarketColors } from '@/features/marketplace';
import { DEAL_STAGE_LABEL, type DealStage } from './transact.constants';

function stageColor(stage: DealStage): { fg: string; bg: string } {
  switch (stage) {
    case 'completed':
      return { fg: MarketColors.ok, bg: MarketColors.okBg };
    case 'offer_accepted':
      return { fg: MarketColors.brand, bg: MarketColors.warnBg };
    case 'offer_pending':
      return { fg: MarketColors.warnText, bg: MarketColors.warnBg };
    default:
      return { fg: MarketColors.accent, bg: MarketColors.surfaceAlt };
  }
}

export function DealStageChip({ stage }: { stage: DealStage }) {
  const c = stageColor(stage);
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <View style={[styles.dot, { backgroundColor: c.fg }]} />
      <Text style={[styles.label, { color: c.fg }]}>{DEAL_STAGE_LABEL[stage]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  label: { ...Typography.labelSm, fontWeight: '700' },
});
