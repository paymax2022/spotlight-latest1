import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ReviewScore } from '@/features/stays/components';
import { useProperty, useReviews } from '@/features/stays/hooks';
import { REVIEW_DIMENSIONS, REVIEW_DIMENSION_LABEL, StaysColors } from '@/features/stays/constants/stays.constants';

export default function ReviewsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const prop = useProperty(String(id));
  const reviews = useReviews(String(id));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Guest reviews" subtitle={prop.data?.name} />
      {reviews.isLoading || prop.isLoading ? (
        <StateView kind="loading" message="Loading reviews…" />
      ) : reviews.isError ? (
        <StateView kind="error" title="Couldn't load reviews" actionLabel="Retry" onAction={() => reviews.refetch()} />
      ) : (reviews.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="MessageSquare" title="No reviews yet" message="Be the first to review after your stay." />
      ) : (
        <FlatList
          data={reviews.data}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            prop.data ? (
              <View style={styles.summary}>
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
