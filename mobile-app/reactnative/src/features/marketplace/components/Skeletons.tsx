import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors } from '../constants';

// Skeleton blocks (never spinners on content areas — offline-first convention).
// Static (no shimmer dependency) so they render instantly from cache-cold.

function Block({ w, h, r = Radius.md, style }: { w?: number | string; h: number; r?: number; style?: object }) {
  return <View style={[styles.block, { width: (w as number) ?? '100%', height: h, borderRadius: r }, style]} />;
}

export function CardSkeleton() {
  return (
    <View style={styles.card}>
      <Block h={120} />
      <Block h={12} w="80%" style={styles.mt8} />
      <Block h={14} w="50%" style={styles.mt6} />
    </View>
  );
}

export function GridSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View style={styles.grid}>
      {Array.from({ length: rows * 2 }).map((_, i) => (
        <View key={i} style={styles.gridCell}><CardSkeleton /></View>
      ))}
    </View>
  );
}

export function RailSkeleton() {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail} scrollEnabled={false}>
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={i} style={styles.railCell}><CardSkeleton /></View>
      ))}
    </ScrollView>
  );
}

export function CategoryGridSkeleton() {
  return (
    <View style={styles.catGrid}>
      {Array.from({ length: 8 }).map((_, i) => (
        <View key={i} style={styles.catCell}>
          <Block h={48} w={48} r={Radius.lg} />
          <Block h={10} w={40} style={styles.mt6} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: MarketColors.surfaceAlt },
  mt8: { marginTop: 8 },
  mt6: { marginTop: 6 },
  card: { backgroundColor: MarketColors.surface, borderRadius: Radius.lg, padding: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  gridCell: { width: '48%' },
  rail: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  railCell: { width: 160, marginRight: Spacing.sm },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  catCell: { width: '20%', alignItems: 'center', gap: 6 },
});
