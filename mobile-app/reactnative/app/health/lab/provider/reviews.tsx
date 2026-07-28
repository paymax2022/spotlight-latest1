import React, { useMemo } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Star } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';

import { useProviderReviews } from '@/features/health/lab/hooks';
import type { LabReview } from '@/features/health/lab/types';
import { relativeTime } from '@/features/health/constants/health.constants';

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={styles.starsRow}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          color={Colors.gold}
          fill={i <= Math.round(rating) ? Colors.gold : 'transparent'}
        />
      ))}
    </View>
  );
}

function ReviewCard({ review }: { review: LabReview }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.author}>{review.author}</Text>
        <Text style={styles.time}>{relativeTime(review.at)}</Text>
      </View>
      <Stars rating={review.rating} />
      <Text style={styles.body}>{review.body}</Text>
    </View>
  );
}

export default function LabProviderReviewsScreen() {
  const reviews = useProviderReviews();
  const data = reviews.data ?? [];

  const average = useMemo(() => {
    if (data.length === 0) return 0;
    return data.reduce((sum, r) => sum + r.rating, 0) / data.length;
  }, [data]);

  if (reviews.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Reviews" subtitle="Patient feedback" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  if (reviews.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Reviews" subtitle="Patient feedback" />
        <StateView
          kind="error"
          title="Couldn't load reviews"
          message="Please try again."
          actionLabel="Retry"
          onAction={() => reviews.refetch()}
        />
      </SafeAreaView>
    );
  }

  if (data.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Reviews" subtitle="Patient feedback" />
        <StateView
          kind="empty"
          icon="Star"
          title="No reviews yet"
          message="Patient reviews of your lab will appear here."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reviews" subtitle="Patient feedback" />
      <FlatList
        data={data}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => <ReviewCard review={item} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.summaryCard}>
            <Text style={styles.avg}>{average.toFixed(1)}</Text>
            <Stars rating={average} size={18} />
            <Text style={styles.count}>
              {data.length} review{data.length === 1 ? '' : 's'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
    ...shadow1,
  },
  avg: { ...Typography.headlineMd, color: Colors.onSurface },
  count: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  starsRow: { flexDirection: 'row', gap: 2 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...shadow1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  author: { ...Typography.titleMd, color: Colors.onSurface },
  time: { ...Typography.caption, color: Colors.onSurfaceVariant },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
});
