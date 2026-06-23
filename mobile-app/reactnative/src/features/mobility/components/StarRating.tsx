import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

interface Props {
  value: number;
  onChange?: (stars: number) => void;
  size?: number;
  readonly?: boolean;
}

/** 1–5 star selector / display. Interactive unless readonly. */
export default function StarRating({ value, onChange, size = 40, readonly }: Props) {
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((s) => {
        const filled = s <= value;
        const star = (
          <Star
            size={size}
            color={filled ? Colors.gold : Colors.outlineVariant}
            fill={filled ? Colors.gold : 'transparent'}
            strokeWidth={filled ? 0 : 1.6}
          />
        );
        if (readonly || !onChange) return <View key={s}>{star}</View>;
        return (
          <Pressable key={s} onPress={() => onChange(s)} hitSlop={6} accessibilityLabel={`${s} star${s > 1 ? 's' : ''}`}>
            {star}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center' },
});
