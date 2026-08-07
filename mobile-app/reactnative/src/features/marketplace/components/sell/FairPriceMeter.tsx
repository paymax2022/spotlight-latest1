// ── Sell — live fair-price band meter (Price screen, screen 13) ──────────────
// A horizontal band (p25 … p75, median marked) with the seller's current price
// plotted on it. Non-blocking: a price outside the band shows a nudge, never a
// hard stop (spec §13: "seller's price, seller's call").
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors, formatNaira, fairPriceVerdict, FAIR_PRICE_LABEL } from '@/features/marketplace';
import type { FairPriceBand } from '@/features/marketplace';

interface Props {
  priceKobo: number;
  band: FairPriceBand | null;
}

export default function FairPriceMeter({ priceKobo, band }: Props) {
  if (!band) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.noBand}>No comparable-price data for this category yet — price with your best judgement.</Text>
      </View>
    );
  }

  const verdict = fairPriceVerdict(priceKobo, band);
  // Plot position: clamp price into a display window slightly wider than the band.
  const lo = band.p25Kobo * 0.6;
  const hi = band.p75Kobo * 1.4;
  const clamp = Math.max(lo, Math.min(hi, priceKobo || band.p50Kobo));
  const pos = ((clamp - lo) / (hi - lo)) * 100;
  const bandStart = ((band.p25Kobo - lo) / (hi - lo)) * 100;
  const bandEnd = ((band.p75Kobo - lo) / (hi - lo)) * 100;
  const medianPos = ((band.p50Kobo - lo) / (hi - lo)) * 100;

  const verdictColor =
    verdict === 'below' ? MarketColors.brand : verdict === 'above' ? MarketColors.warnText : MarketColors.ok;

  const nudge =
    verdict === 'above'
      ? "Priced above similar listings — it may sell slower. That's your call."
      : verdict === 'below'
        ? 'Priced below the going rate — great for a fast sale.'
        : 'Right in the fair-price range — buyers are likely to trust this price.';

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.title}>Fair-price range</Text>
        {priceKobo > 0 ? (
          <View style={[styles.verdictChip, { backgroundColor: verdictColor + '1A' }]}>
            <Text style={[styles.verdictText, { color: verdictColor }]}>{FAIR_PRICE_LABEL[verdict] || '—'}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.track}>
        <View style={[styles.bandFill, { left: `${bandStart}%`, width: `${Math.max(0, bandEnd - bandStart)}%` }]} />
        <View style={[styles.median, { left: `${medianPos}%` }]} />
        {priceKobo > 0 ? <View style={[styles.marker, { left: `${pos}%`, backgroundColor: verdictColor }]} /> : null}
      </View>

      <View style={styles.scaleRow}>
        <Text style={styles.scaleText}>{formatNaira(band.p25Kobo)}</Text>
        <Text style={styles.scaleTextMid}>{formatNaira(band.p50Kobo)}</Text>
        <Text style={styles.scaleText}>{formatNaira(band.p75Kobo)}</Text>
      </View>

      {priceKobo > 0 ? <Text style={styles.nudge}>{nudge}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: MarketColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: MarketColors.border, padding: Spacing.md, gap: Spacing.sm },
  noBand: { ...Typography.labelSm, color: MarketColors.muted },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700' },
  verdictChip: { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  verdictText: { ...Typography.labelSm, fontWeight: '700' },
  track: { height: 10, borderRadius: 5, backgroundColor: MarketColors.surfaceAlt, marginTop: 4, position: 'relative', overflow: 'visible' },
  bandFill: { position: 'absolute', top: 0, height: 10, borderRadius: 5, backgroundColor: MarketColors.okBg },
  median: { position: 'absolute', top: -2, width: 2, height: 14, backgroundColor: MarketColors.ok },
  marker: { position: 'absolute', top: -3, width: 12, height: 16, marginLeft: -6, borderRadius: 4, borderWidth: 2, borderColor: '#FFFFFF' },
  scaleRow: { flexDirection: 'row', justifyContent: 'space-between' },
  scaleText: { ...Typography.labelSm, color: MarketColors.muted },
  scaleTextMid: { ...Typography.labelSm, color: MarketColors.text, fontWeight: '600' },
  nudge: { ...Typography.labelSm, color: MarketColors.muted },
});
