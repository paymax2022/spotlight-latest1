import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { scoreWord } from '../constants/stays.constants';

interface Props {
  score: number;            // out of 10
  reviewCount?: number;
  size?: 'sm' | 'md';
  showWord?: boolean;
}

/** Booking.com-style review-score chip + word + count. */
export default function ReviewScore({ score, reviewCount, size = 'md', showWord = true }: Props) {
  const small = size === 'sm';
  return (
    <View style={styles.row}>
      <View style={[styles.badge, small && styles.badgeSm]}>
        <Text style={[styles.score, small && styles.scoreSm]}>{score.toFixed(1)}</Text>
      </View>
      {showWord ? (
        <View>
          <Text style={[styles.word, small && styles.wordSm]}>{scoreWord(score)}</Text>
          {reviewCount != null ? (
            <Text style={styles.count}>{reviewCount.toLocaleString('en-NG')} reviews</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.DEFAULT,
    minWidth: 40,
    paddingHorizontal: 8,
    paddingVertical: 5,
    alignItems: 'center',
  },
  badgeSm: { minWidth: 34, paddingVertical: 3, paddingHorizontal: 6 },
  score: { ...Typography.labelLg, color: Colors.onPrimary, fontWeight: '800' as const },
  scoreSm: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '800' as const },
  word: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' as const },
  wordSm: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '700' as const },
  count: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
