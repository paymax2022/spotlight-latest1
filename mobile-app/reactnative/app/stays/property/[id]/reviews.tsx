import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ReviewScore } from '@/features/stays/components';
import { useProperty, useReviews } from '@/features/stays/hooks';
import { useTrips } from '@/features/stays/trips';
import { REVIEW_DIMENSIONS, REVIEW_DIMENSION_LABEL, StaysColors } from '@/features/stays/constants/stays.constants';

export default function ReviewsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const prop = useProperty(String(id));
  const reviews = useReviews(String(id));
  const past = useTrips('past');
  // A guest may review only after a completed stay here. Match by property name, since
  // trips carry the reservation's property record rather than this page's listing key.
  const reviewableStay = prop.data
    ? (past.data ?? []).find((t) => t.state === 'COMPLETED' && t.propertyName === prop.data!.name)
    : undefined;

  const writeButton = reviewableStay ? (
    <Pressable
      style={styles.writeBtn}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/stays/reviews/write', params: { id: reviewableStay.id } })}
    >
      <Text style={styles.writeBtnText}>Write a review</Text>
    </Pressable>
  ) : (
    <Text style={styles.muted}>Complete a stay at this property to leave a review.</Text>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Guest reviews" subtitle={prop.data?.name} />
      {reviews.isLoading || prop.isLoading ? (
        <StateView kind="loading" message="Loading reviews…" />
      ) : reviews.isError ? (
        <StateView kind="error" title="Couldn't load reviews" actionLabel="Retry" onAction={() => reviews.refetch()} />
      ) : (reviews.data?.length ?? 0) === 0 ? (
        <View style={styles.emptyWrap}>
          <StateView kind="empty" icon="MessageSquare" title="No reviews yet" message="Be the first to review after your stay." />
          {writeButton}
        </View>
      ) : (
        <FlatList
          data={reviews.data}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            prop.data ? (
              <View style={styles.summary}>
                {writeButton}
                <ReviewScore score={prop.data.reviewScore} reviewCount={prop.data.reviewCount} />
                <View style={styles.subScores}>
                  {REVIEW_DIMENSIONS.map((d) => {
                    const v = prop.data!.subScores[d];
                    return (
                      <View key={d} style={styles.subRow}>
                        <Text style={styles.subLabel}>{REVIEW_DIMENSION_LABEL[d]}</Text>
                        <View style={styles.bar}>
                          <View style={[styles.barFill, { width: `${(v / 10) * 100}%` }]} />
                        </View>
                        <Text style={styles.subVal}>{v.toFixed(1)}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null
          }
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{item.author.charAt(0)}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.author}>{item.author}</Text>
                  <Text style={styles.meta}>{item.country} · {item.roomType} · {item.stayDate}</Text>
                </View>
                <ReviewScore score={item.score} size="sm" showWord={false} />
              </View>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
              {item.hotelierResponse ? (
                <View style={styles.response}>
                  <Text style={styles.responseLabel}>Response from property</Text>
                  <Text style={styles.responseText}>{item.hotelierResponse}</Text>
                </View>
              ) : null}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  writeBtn: { alignSelf: 'center', backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg, marginVertical: Spacing.md },
  writeBtnText: { ...Typography.labelLg, color: Colors.onPrimary },
  muted: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center', marginVertical: Spacing.sm },
  emptyWrap: { flex: 1, padding: Spacing.containerMargin },
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  summary: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md, gap: Spacing.md },
  subScores: { gap: Spacing.sm },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  subLabel: { ...Typography.bodySm, color: Colors.onSurface, width: 90 },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.surfaceContainerHigh, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: StaysColors.brand },
  subVal: { ...Typography.labelSm, color: Colors.onSurface, width: 28, textAlign: 'right' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.labelLg, color: Colors.onPrimary },
  author: { ...Typography.bodyMd, color: Colors.onSurface, fontWeight: '600' as const },
  meta: { ...Typography.caption, color: Colors.onSurfaceVariant },
  title: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 2 },
  body: { ...Typography.bodySm, color: Colors.onSurface },
  response: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm, marginTop: 4 },
  responseLabel: { ...Typography.labelSm, color: Colors.primary },
  responseText: { ...Typography.bodySm, color: Colors.onSurface, marginTop: 2 },
});
