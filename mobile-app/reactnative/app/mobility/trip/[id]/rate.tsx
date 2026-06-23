import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2, Receipt } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import StarRating from '@/features/mobility/components/StarRating';
import DriverCard from '@/features/mobility/components/DriverCard';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useTrip, useRateTrip } from '@/features/mobility/hooks/useMobility';
import { clearMockActiveTrip } from '@/features/mobility/api/mobility.api';
import { TIP_PRESETS_KOBO } from '@/features/mobility/constants/mobility.constants';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';

export default function RateTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id);
  const rate = useRateTrip();

  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [tipKobo, setTipKobo] = useState(0);

  const t = trip.data;
  const paymentFailed = t?.paymentStatus === 'failed';

  const onSubmit = () => {
    if (!id || stars < 1) return;
    rate.mutate(
      { tripId: id, draft: { stars, comment: comment.trim() || undefined, tipKobo: tipKobo || undefined } },
      {
        onSuccess: () => {
          clearMockActiveTrip();
          router.replace('/mobility');
        },
      },
    );
  };

  const onSkip = () => {
    clearMockActiveTrip();
    router.replace('/mobility');
  };

  if (trip.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StateView kind="loading" message="Loading receipt…" />
      </SafeAreaView>
    );
  }

  if (trip.isError || !t) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => trip.refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Payment confirmation */}
        {paymentFailed ? (
          <MobilityEdgeState
            kind="paymentFailed"
            compact
            actionLabel="Retry payment"
            onAction={() => router.push('/wallet/add')}
          />
        ) : (
          <View style={styles.confirmation}>
            <View style={styles.checkCircle}>
              <CheckCircle2 size={40} color={Colors.tertiaryContainer} strokeWidth={2} />
            </View>
            <Text style={styles.confTitle}>Trip completed</Text>
            <Text style={styles.confSub}>{formatNairaWhole(t.fareKobo)} paid from your {t.paymentMethod === 'wallet' ? 'wallet' : t.paymentMethod}</Text>
          </View>
        )}

        {/* Receipt */}
        <FareBreakdownCard
          title="Receipt"
          fareKobo={t.fareKobo}
          distanceM={t.distanceM}
          durationS={t.durationS}
          rows={[
            { label: 'Payment', valueText: t.paymentMethod === 'wallet' ? 'Paymax wallet' : t.paymentMethod === 'card' ? 'Card' : 'Cash' },
            { label: 'Status', valueText: paymentFailed ? 'Failed' : 'Paid' },
          ]}
        />

        {/* Rate driver */}
        {t.driver && (
          <View style={[styles.card, shadow1]}>
            <Text style={styles.cardTitle}>Rate your driver</Text>
            <DriverCard driver={t.driver} compact />
            <View style={styles.starsWrap}>
              <StarRating value={stars} onChange={setStars} />
            </View>

            <TextInputField
              placeholder="Add a comment (optional)"
              value={comment}
              onChangeText={setComment}
              multiline
              numberOfLines={3}
            />

            {/* Tip */}
            <Text style={styles.tipLabel}>Add a tip</Text>
            <View style={styles.tipRow}>
              {TIP_PRESETS_KOBO.map((preset) => {
                const active = tipKobo === preset;
                return (
                  <Pressable key={preset} style={[styles.tipChip, active && styles.tipChipActive]} onPress={() => setTipKobo(preset)}>
                    <Text style={[styles.tipChipLabel, active && styles.tipChipLabelActive]}>
                      {preset === 0 ? 'No tip' : formatNairaWhole(preset)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.receiptRow}>
          <Receipt size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.receiptText}>A receipt has been sent to your Paymax inbox.</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={tipKobo > 0 ? `Submit & tip ${formatNairaWhole(tipKobo)}` : 'Submit rating'}
          onPress={onSubmit}
          loading={rate.isPending}
          disabled={stars < 1}
        />
        <Pressable onPress={onSkip} style={styles.skip} disabled={rate.isPending}>
          <Text style={styles.skipLabel}>Skip</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, gap: Spacing.md },
  confirmation: { alignItems: 'center', gap: 6, paddingVertical: Spacing.md },
  checkCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.tertiaryFixed, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  confTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  confSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.outlineVariant },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface, marginBottom: Spacing.md },
  starsWrap: { paddingVertical: Spacing.lg },
  tipLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm, marginTop: Spacing.xs },
  tipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tipChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  tipChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  tipChipLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  tipChipLabelActive: { color: Colors.primary },
  receiptRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, justifyContent: 'center' },
  receiptText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.xs },
  skip: { height: 44, alignItems: 'center', justifyContent: 'center' },
  skipLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});
