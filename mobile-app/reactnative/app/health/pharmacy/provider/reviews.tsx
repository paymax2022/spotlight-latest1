import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useReviews } from '@/features/health/pharmacy/hooks';
import { formatDate } from '@/features/health/constants/health.constants';
import type { PharmacyReview } from '@/features/health/pharmacy/types';

function Stars({ rating, size }: { rating: number; size: number }) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} color={Colors.gold} fill={n <= rating ? Colors.gold : 'transparent'} strokeWidth={1.6} />
      ))}
    </View>
  );
}

export default function ProviderReviewsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useReviews();

  const reviews = data ?? [];
  const total = reviews.length;
  const average = total > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / total : 0;
  const rounded = Math.round(average);

  const renderRow = ({ item }: { item: PharmacyReview }) => (
    <View style={[styles.card, shadow1]}>
      <View style={styles.cardHead}>
        <Text style={styles.author}>{item.author}</Text>
        <Stars rating={item.rating} size={12} />
      </View>
      <Text style={styles.body}>{item.body}</Text>
      <View style={styles.cardFoot}>
        <Text style={styles.date}>{formatDate(item.at)}</Text>
        {item.orderRef ? <Text style={styles.orderRef}>{item.orderRef}</Text> : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reviews" subtitle="What patients say" />

      {isLoading ? (
        <StateView kind="loading" message="Loading reviews…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load reviews" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListHeaderComponent={
            total > 0 ? (
              <View style={[styles.summary, shadow1]}>
                <Text style={styles.avgNumber}>{average.toFixed(1)}</Text>
                <Stars rating={rounded} size={20} />
                <Text style={styles.avgCount}>
                  Based on {total} {total === 1 ? 'review' : 'reviews'}
                </Text>
              </View>
            ) : null
          }
          renderItem={renderRow}
          ListEmptyComponent={
            <StateView kind="empty" icon="Star" title="No reviews yet" message="Patient reviews of your pharmacy will appear here." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40, flexGrow: 1 },
  summary: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  avgNumber: { ...Typography.displayLg, fontSize: 44, lineHeight: 50, color: Colors.onSurface },
  avgCount: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  starRow: { flexDirection: 'row', gap: 2 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  author: { ...Typography.labelLg, color: Colors.onSurface },
  body: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 19 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { ...Typography.caption, color: Colors.outline },
  orderRef: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
