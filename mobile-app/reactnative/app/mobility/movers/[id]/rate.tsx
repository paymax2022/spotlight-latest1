import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import StarRating from '@/features/mobility/components/StarRating';
import FareBreakdownCard from '@/features/mobility/components/FareBreakdownCard';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { useMoverJob, useMoverActions } from '@/features/mobility/hooks/useModes';
import { clearMockActiveMover } from '@/features/mobility/api/movers.api';
import { formatNairaWhole } from '@/features/mobility/utils/mobilityFormatters';

export default function RateMoverScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const job = useMoverJob(id);
  const { rate } = useMoverActions();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const j = job.data;

  const finish = () => { clearMockActiveMover(); router.replace('/mobility'); };
  const onSubmit = () => { if (id && stars >= 1) rate.mutate({ id, stars, comment: comment.trim() || undefined }, { onSuccess: finish }); };

  if (job.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading…" /></SafeAreaView>;
  if (job.isError || !j) return <SafeAreaView style={styles.safe} edges={['top']}><MobilityEdgeState kind="offline" actionLabel="Retry" onAction={() => job.refetch()} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.confirmation}>
          <View style={styles.checkCircle}><CheckCircle2 size={40} color={Colors.tertiaryContainer} strokeWidth={2} /></View>
          <Text style={styles.confTitle}>Move complete</Text>
          <Text style={styles.confSub}>{formatNairaWhole(j.fareKobo ?? 0)} released from escrow</Text>
        </View>
        <FareBreakdownCard title="Receipt" fareKobo={j.fareKobo ?? 0} rows={[{ label: 'Provider', valueText: j.acceptedBid?.providerName ?? '—' }, { label: 'Status', valueText: 'Paid' }]} />
        {j.acceptedBid && (
          <View style={[styles.card, shadow1]}>
            <Text style={styles.cardTitle}>Rate {j.acceptedBid.providerName}</Text>
            <View style={styles.starsWrap}><StarRating value={stars} onChange={setStars} /></View>
            <TextInputField placeholder="Add a comment (optional)" value={comment} onChangeText={setComment} multiline numberOfLines={3} />
          </View>
        )}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Submit rating" onPress={onSubmit} loading={rate.isPending} disabled={stars < 1} />
        <Pressable onPress={finish} style={styles.skip} disabled={rate.isPending}><Text style={styles.skipLabel}>Skip</Text></Pressable>
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
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.xs },
  skip: { height: 44, alignItems: 'center', justifyContent: 'center' },
  skipLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});
