import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Star, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useReviews, useSubmitReview } from '@/features/health/pharmacy/hooks';
import { formatDate } from '@/features/health/constants/health.constants';

export default function RatingsScreen() {
  const { pharmacyId, orderId } = useLocalSearchParams<{ pharmacyId?: string; orderId?: string }>();
  const { data: reviews, isLoading, isError, refetch } = useReviews(pharmacyId);
  const submit = useSubmitReview();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (rating === 0) {
      setError('Tap a star to rate your experience.');
      return;
    }
    if (!orderId) {
      // A review always attaches to a specific completed order (server-gated
      // to DELIVERED/COLLECTED/CLOSED, ADR-017) — there is no freeform
      // "rate this pharmacy" without one.
      setError('Open this screen from a completed order to leave a review.');
      return;
    }
    setError(null);
    try {
      await submit.mutateAsync({ pharmacyId: pharmacyId ?? '', orderId, rating, body: body.trim() });
      setDone(true);
    } catch {
      setError('Could not submit your review. Please try again.');
    }
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Thanks!" />
        <StateView
          kind="empty"
          icon="CircleCheck"
          title="Review submitted"
          message="Thank you for helping other patients choose a trusted pharmacy."
          actionLabel="Done"
          onAction={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Rate your order" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Rate */}
        <View style={[styles.rateCard, shadow1]}>
          <Text style={styles.rateTitle}>How was your experience?</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}>
                <Star
                  size={36}
                  color={Colors.gold}
                  fill={n <= rating ? Colors.gold : 'transparent'}
                  strokeWidth={1.6}
                />
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Share details about delivery, packaging, the pharmacist…"
            placeholderTextColor={Colors.outline}
            value={body}
            onChangeText={setBody}
            multiline
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton label="Submit review" onPress={onSubmit} loading={submit.isPending} />
        </View>

        {/* Existing reviews */}
        <Text style={styles.sectionTitle}>What others say</Text>
        {isLoading ? (
          <StateView kind="loading" compact message="Loading reviews…" />
        ) : isError ? (
          <StateView kind="error" compact title="Couldn't load reviews" message="Please try again." actionLabel="Retry" onAction={refetch} />
        ) : (reviews ?? []).length === 0 ? (
          <StateView kind="empty" compact icon="Star" title="No reviews yet" message="Be the first to review." />
        ) : (
          (reviews ?? []).map((r) => (
            <View key={r.id} style={[styles.review, shadow1]}>
              <View style={styles.reviewHead}>
                <Text style={styles.author}>{r.author}</Text>
                <View style={styles.reviewStars}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} size={12} color={Colors.gold} fill={n <= r.rating ? Colors.gold : 'transparent'} strokeWidth={1.6} />
                  ))}
                </View>
              </View>
              <Text style={styles.reviewBody}>{r.body}</Text>
              <Text style={styles.reviewDate}>{formatDate(r.at)}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  rateCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  rateTitle: { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm },
  input: {
    ...Typography.bodyMd,
    color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  error: { ...Typography.labelMd, color: Colors.error },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  review: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: 4,
  },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  author: { ...Typography.labelLg, color: Colors.onSurface },
  reviewStars: { flexDirection: 'row', gap: 1 },
  reviewBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 19 },
  reviewDate: { ...Typography.caption, color: Colors.outline },
});
