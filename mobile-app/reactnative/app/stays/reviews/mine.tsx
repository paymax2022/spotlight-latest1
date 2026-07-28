import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Star, MessageSquareQuote, PencilLine } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useMyReviews, useReviewableStays } from '@/features/stays/reviews';
import { scoreWord } from '@/features/stays/constants/stays.constants';

export default function MyReviewsScreen() {
  const reviews = useMyReviews();
  const pending = useReviewableStays();

  const loading = reviews.isLoading || pending.isLoading;
  const error = reviews.isError;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My reviews" subtitle="Verified post-stay reviews" />
      {loading ? (
        <StateView kind="loading" message="Loading your reviews…" />
      ) : error ? (
        <StateView kind="error" title="Couldn't load reviews" actionLabel="Retry" onAction={() => reviews.refetch()} />
      ) : (reviews.data?.length ?? 0) === 0 && (pending.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="Star" title="No reviews yet" message="Complete a stay to unlock a verified review." actionLabel="My bookings" onAction={() => router.replace('/stays/trips')} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {(pending.data?.length ?? 0) > 0 ? (
            <>
              <Text style={styles.section}>Awaiting your review</Text>
              {pending.data!.map((s) => (
                <Pressable key={s.reservationId} style={styles.pending} onPress={() => router.push({ pathname: '/stays/reviews/write', params: { id: s.reservationId } })}>
                  <Image source={{ uri: s.coverUrl }} style={styles.pendingImg} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pendingName} numberOfLines={1}>{s.propertyName}</Text>
                    <Text style={styles.pendingSub} numberOfLines={1}>{s.city} · {s.roomTypeName}</Text>
                  </View>
                  <View style={styles.writeBtn}>
                    <PencilLine size={14} color={Colors.onPrimary} />
                    <Text style={styles.writeBtnText}>Write</Text>
                  </View>
                </Pressable>
              ))}
            </>
          ) : null}

          {(reviews.data?.length ?? 0) > 0 ? (
            <>
              <Text style={styles.section}>Published</Text>
              {reviews.data!.map((r) => (
                <View key={r.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Image source={{ uri: r.coverUrl }} style={styles.cardImg} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardName} numberOfLines={1}>{r.propertyName}</Text>
                      <View style={styles.scoreRow}>
                        <Star size={14} color={Colors.gold} fill={Colors.gold} />
                        <Text style={styles.scoreText}>{r.overall.toFixed(1)} · {scoreWord(r.overall)}</Text>
                      </View>
                    </View>
                  </View>
                  <Text style={styles.reviewTitle}>{r.title}</Text>
                  <Text style={styles.reviewBody}>{r.body}</Text>
                  {r.hotelierResponse ? (
                    <View style={styles.response}>
                      <MessageSquareQuote size={14} color={Colors.primary} />
                      <Text style={styles.responseText}>{r.hotelierResponse}</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  section: { ...Typography.titleMd, color: Colors.onSurface },
  pending: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.sm },
  pendingImg: { width: 56, height: 56, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainer },
  pendingName: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '600' as const },
  pendingSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  writeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  writeBtnText: { ...Typography.labelSm, color: Colors.onPrimary, fontWeight: '700' as const },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  cardImg: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainer },
  cardName: { ...Typography.titleMd, color: Colors.onSurface },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  scoreText: { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '600' as const },
  reviewTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' as const },
  reviewBody: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  response: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.md, padding: Spacing.md },
  responseText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, fontStyle: 'italic' },
});
