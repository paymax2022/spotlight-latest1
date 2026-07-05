import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MessageCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import StarRating from '@/features/health/vet/components/StarRating';
import { useProviderReviews } from '@/features/health/vet/hooks';
import { formatDate } from '@/features/health/constants/health.constants';

export default function ProviderReviewsScreen() {
  const { data: reviews, isLoading, isError, refetch } = useProviderReviews();

  const avg =
    reviews && reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reviews" subtitle="What pet owners say" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <StateView kind="loading" message="Loading reviews…" compact />
        ) : isError ? (
          <StateView kind="error" title="Couldn't load reviews" actionLabel="Retry" onAction={refetch} compact />
        ) : (reviews ?? []).length === 0 ? (
          <StateView kind="empty" icon="Star" title="No reviews yet" message="Reviews appear after completed consults." compact />
        ) : (
          <>
            <View style={styles.summary}>
              <Text style={styles.avg}>{avg.toFixed(1)}</Text>
              <StarRating rating={avg} size={18} />
              <Text style={styles.count}>{(reviews ?? []).length} reviews</Text>
            </View>

            {(reviews ?? []).map((r) => (
              <View key={r.id} style={[styles.card, shadow1]}>
                <View style={styles.head}>
                  <View style={styles.icon}>
                    <MessageCircle size={14} color={Colors.secondary} strokeWidth={2} />
                  </View>
                  <Text style={styles.author}>{r.author}</Text>
                  <StarRating rating={r.rating} size={12} />
                </View>
                <Text style={styles.body}>{r.body}</Text>
                <Text style={styles.date}>{formatDate(r.at)}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  summary: { alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg },
  avg: { ...Typography.displayLg, fontSize: 40, color: Colors.primary },
  count: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  author: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  body: { ...Typography.bodySm, color: Colors.onSurface },
  date: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
