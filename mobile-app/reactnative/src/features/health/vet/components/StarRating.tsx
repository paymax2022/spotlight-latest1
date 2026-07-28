import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';

/**
 * Star rating — read-only (shows rating + optional count) or interactive
 * (pass onChange to let the user pick). Used on vet cards, profiles & ratings.
 */
export default function StarRating({
  rating,
  count,
  size = 14,
  onChange,
}: {
  rating: number;
  count?: number;
  size?: number;
  onChange?: (value: number) => void;
}) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <View style={styles.row} accessibilityRole={onChange ? 'adjustable' : 'text'}>
      {stars.map((s) => {
        const filled = s <= Math.round(rating);
        const star = (
          <Star
            size={size}
            color={filled ? Colors.gold : Colors.outlineVariant}
            fill={filled ? Colors.gold : 'transparent'}
            strokeWidth={2}
          />
        );
        return onChange ? (
          <Pressable key={s} onPress={() => onChange(s)} hitSlop={6} accessibilityLabel={`${s} star`}>
            {star}
          </Pressable>
        ) : (
          <View key={s}>{star}</View>
        );
      })}
      {!onChange ? (
        <Text style={styles.label}>
          {rating.toFixed(1)}
          {count != null ? ` (${count})` : ''}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginLeft: 4 },
});
