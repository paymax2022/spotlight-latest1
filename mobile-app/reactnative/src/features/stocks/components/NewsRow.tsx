import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Newspaper } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { relativeTime } from '../utils/stockFormatters';
import type { StockNews } from '../types/stocks.types';

interface Props {
  news: StockNews;
  onPress?: () => void;
}

/** News headline row: icon · title/summary · source + time. */
export default function NewsRow({ news, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={news.title}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.iconBox}>
        <Newspaper size={18} color={Colors.primary} strokeWidth={2} />
      </View>
      <View style={styles.mid}>
        <Text style={styles.title} numberOfLines={2}>{news.title}</Text>
        <Text style={styles.sub} numberOfLines={1}>{news.source} · {relativeTime(news.publishedAt)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  pressed: { opacity: 0.7 },
  iconBox: {
    width: 42, height: 42, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple,
  },
  mid: { flex: 1, gap: 3 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
