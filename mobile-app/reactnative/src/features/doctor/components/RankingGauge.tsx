import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

interface Props {
  percentile: number;            // 0–100 (top X%)
  rankLabel:  string;            // "Top 5% of GPs on Spotlight"
  specialty:  string;
  movement:   'up' | 'down' | 'flat';
  movementPlaces: number;
}

// New component (Z): a percentile ranking gauge (big percentile + filled track +
// rank label + movement chip) for the ranking-insight screen. No existing
// component renders a single percentile gauge with a movement indicator, so this
// is genuinely new (token-only, no charting dep).
export default function RankingGauge({ percentile, rankLabel, specialty, movement, movementPlaces }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(percentile)));
  const Icon = movement === 'up' ? TrendingUp : movement === 'down' ? TrendingDown : Minus;
  const moveTone = movement === 'up' ? Colors.teal : movement === 'down' ? Colors.error : Colors.onSurfaceVariant;
  return (
    <View style={styles.card}>
      <Text style={styles.specialty} numberOfLines={1}>{specialty}</Text>
      <View style={styles.row}>
        <Text style={styles.percentile}>{pct}<Text style={styles.pctSuffix}>th</Text></Text>
        <View style={[styles.movePill, { backgroundColor: Colors.surfaceContainerLow }]}>
          <Icon size={14} color={moveTone} strokeWidth={2.4} />
          <Text style={[styles.moveText, { color: moveTone }]}>
            {movement === 'flat' ? 'No change' : `${movementPlaces} ${movement === 'up' ? 'up' : 'down'}`}
          </Text>
        </View>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.rankLabel}>{rankLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card:       { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.sm },
  specialty:  { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  row:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  percentile: { ...Typography.displayLg, fontSize: 44, letterSpacing: -0.88, lineHeight: 48, color: Colors.primary },
  pctSuffix:  { ...Typography.titleMd, color: Colors.onSurfaceVariant },
  movePill:   { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 10, borderRadius: Radius.full },
  moveText:   { ...Typography.labelSm, fontWeight: '700' },
  track:      { height: 12, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  fill:       { height: '100%', borderRadius: Radius.full, backgroundColor: Colors.primary },
  rankLabel:  { ...Typography.labelLg, color: Colors.onSurface },
});
