import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Icons from 'lucide-react-native';
import StarRating from '@/features/mobility/components/StarRating';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { useOrder, useRateOrder } from '@/features/food/hooks';

export default function RateOrderScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { data: order, isLoading } = useOrder(orderId);
  const rate = useRateOrder();

  const [restaurantStars, setRestaurantStars] = useState(0);
  const [riderStars, setRiderStars] = useState(0);
  const [comment, setComment] = useState('');

  const onSubmit = () => {
    if (!orderId || restaurantStars === 0) return;
    rate.mutate(
      {
        orderId,
        req: {
          restaurantStars,
          riderStars: order?.rider && riderStars > 0 ? riderStars : undefined,
          comment: comment.trim() || undefined,
        },
      },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} style={s.iconButton} accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>Rate your order</Text>
        <View style={s.iconButton} />
      </View>

      {isLoading ? (
        <StateView kind="loading" />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
            <View style={[s.card, shadow1]}>
              <Text style={s.q}>How was the food from {order?.restaurantName ?? 'the restaurant'}?</Text>
              <StarRating value={restaurantStars} onChange={setRestaurantStars} />
            </View>

            {order?.rider ? (
              <View style={[s.card, shadow1]}>
                <Text style={s.q}>How was your delivery by {order.rider.name}?</Text>
                <StarRating value={riderStars} onChange={setRiderStars} />
              </View>
            ) : null}

            <View style={[s.card, shadow1]}>
              <Text style={s.label}>Leave a comment (optional)</Text>
              <TextInput
                style={s.input}
                value={comment}
                onChangeText={setComment}
                placeholder="Tell us more…"
                placeholderTextColor={Colors.outline}
                multiline
              />
            </View>
          </ScrollView>

          <View style={s.footer}>
            <PrimaryButton label="Submit rating" onPress={onSubmit} loading={rate.isPending} disabled={restaurantStars === 0} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    height: 64,
    paddingHorizontal: Spacing.containerMargin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerHigh,
    backgroundColor: 'rgba(248,249,255,0.92)',
  },
  iconButton: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.lg, gap: Spacing.md, alignItems: 'center' },
  q: { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  label: { ...Typography.labelMd, color: Colors.onSurfaceVariant, alignSelf: 'flex-start' },
  input: { ...Typography.bodyMd, width: '100%', minHeight: 80, color: Colors.onSurface, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, paddingTop: Platform.OS === 'ios' ? 12 : 8 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
});
