import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';

interface Props {
  rating:       number;          // 0–5
  size?:        number;
  reviewCount?: number;
  editable?:    boolean;
  onChange?:    (value: number) => void;
}

const GOLD = '#F5B301';

export default function RatingStars({ rating, size = 16, reviewCount, editable, onChange }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((i) => {
          const filled = i <= Math.round(rating);
          const star = (
            <Star
              size={size}
              color={GOLD}
              strokeWidth={2}
              fill={filled ? GOLD : 'transparent'}
            />
          );
          return editable ? (
            <Pressable key={i} hitSlop={6} onPress={() => onChange?.(i)}>
              {star}
            </Pressable>
          ) : (
            <View key={i}>{star}</View>
          );
        })}
      </View>
      {!editable && (
        <Text style={styles.label}>
          {rating.toFixed(1)}
          {typeof reviewCount === 'number' ? ` (${reviewCount})` : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stars: { flexDirection: 'row', gap: 2 },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
