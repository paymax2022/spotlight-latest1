// ── Marketplace — StarRating ─────────────────────────────────────────────────
import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';
import { MarketColors } from '@/features/marketplace';

export default function StarRating({
  value,
  onChange,
  size = 34,
  readOnly,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
  readOnly?: boolean;
}) {
  return (
    <View style={styles.row} accessibilityRole="adjustable" accessibilityLabel={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        const StarNode = (
          <Star
            size={size}
            color={filled ? MarketColors.warn : MarketColors.border}
            fill={filled ? MarketColors.warn : 'transparent'}
            strokeWidth={1.6}
          />
        );
        if (readOnly) return <View key={n} style={styles.star}>{StarNode}</View>;
        return (
          <Pressable key={n} onPress={() => onChange?.(n)} hitSlop={6} style={styles.star} accessibilityLabel={`Rate ${n} stars`}>
            {StarNode}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  star: { padding: 2 },
});
