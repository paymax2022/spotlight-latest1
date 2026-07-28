import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, CircleCheckBig } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow2 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import ScoreSelector from '@/features/stays/components/review-ScoreSelector';
import { useReviewableStay, useWriteReview } from '@/features/stays/reviews';
import {
  REVIEW_DIMENSIONS, REVIEW_DIMENSION_LABEL, formatStayRange, StaysColors,
} from '@/features/stays/constants/stays.constants';
import type { ReviewDimension } from '@/features/stays/constants/stays.constants';

type Scores = Record<ReviewDimension, number>;
const EMPTY_SCORES = REVIEW_DIMENSIONS.reduce(
  (acc, d) => ({ ...acc, [d]: 0 }),
  {} as Scores,
);

/**
 * Write a verified post-stay review (PRD §14 / §17 G, screen 49). Binds to a
 * COMPLETED reservation; the screen is gated on review eligibility.
 */
export default function WriteReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const stay = useReviewableStay(id ?? '');
  const writeM = useWriteReview();
  const [scores, setScores] = useState<Scores>(EMPTY_SCORES);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [done, setDone] = useState(false);

  if (stay.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Write a review" />
        <StateView kind="loading" message="Checking your stay…" />
      </SafeAreaView>
    );
  }
  // Gate: only COMPLETED & unreviewed reservations are eligible.
  if (stay.isError || !stay.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Write a review" />
        <StateView
          kind="empty"
          icon="ShieldX"
          title="Not eligible to review"
          message="Reviews unlock only after a completed stay, and only once per booking."
          actionLabel="My reviews"
          onAction={() => router.replace('/stays/reviews/mine')}
        />
      </SafeAreaView>
    );
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Review submitted" showBack={false} />
        <View style={styles.successWrap}>
          <View style={styles.successIcon}><CircleCheckBig size={48} color={Colors.teal} /></View>
          <Text style={styles.successTitle}>Thank you for your review!</Text>
          <Text style={styles.successMsg}>Verified reviews help other travellers book with confidence. The property may respond.</Text>
          <View style={styles.successActions}>
            <PrimaryButton label="View my reviews" onPress={() => router.replace('/stays/reviews/mine')} />
            <PrimaryButton label="Done" variant="secondary" onPress={() => router.replace('/stays/trips')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const s = stay.data;
  const rated = REVIEW_DIMENSIONS.filter((d) => scores[d] > 0).length;
  const canSubmit = rated === REVIEW_DIMENSIONS.length && title.trim().length > 0 && body.trim().length > 0;

  function submit() {
    if (!id || !canSubmit) return;
    writeM.mutate(
      { reservationId: id, propertyId: s.propertyId, subScores: scores, title: title.trim(), body: body.trim() },
      { onSuccess: () => setDone(true) },
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Write a review" subtitle={s.propertyName} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.verified}>
          <ShieldCheck size={16} color={StaysColors.ok} strokeWidth={2.2} />
          <Text style={styles.verifiedText}>Verified stay · {s.city} · {formatStayRange(s.checkIn, s.checkOut)}</Text>
        </View>

        <Text style={styles.section}>Rate your stay</Text>
        <View style={styles.scoresCard}>
          {REVIEW_DIMENSIONS.map((d) => (
            <ScoreSelector
              key={d}
              label={REVIEW_DIMENSION_LABEL[d]}
              value={scores[d]}
              onChange={(v) => setScores((prev) => ({ ...prev, [d]: v }))}
            />
          ))}
        </View>

        <Text style={styles.section}>Your review</Text>
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          placeholder="Title (e.g. Great location, friendly staff)"
          placeholderTextColor={Colors.onSurfaceVariant}
        />
        <TextInput
          style={styles.bodyInput}
          value={body}
          onChangeText={setBody}
          placeholder="Tell other travellers about your stay…"
          placeholderTextColor={Colors.onSurfaceVariant}
          multiline
        />
        <Text style={styles.progress}>{rated}/{REVIEW_DIMENSIONS.length} categories rated</Text>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={writeM.isPending ? 'Submitting…' : 'Submit review'} loading={writeM.isPending} disabled={!canSubmit} onPress={submit} />
        {writeM.isError ? <Text style={styles.err}>Couldn't submit. Please try again.</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  verified: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md },
  verifiedText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  section: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  scoresCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.lg },
  titleInput: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, ...Typography.bodyMd, color: Colors.onSurface },
  bodyInput: { minHeight: 120, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, ...Typography.bodyMd, color: Colors.onSurface, textAlignVertical: 'top' },
  progress: { ...Typography.caption, color: Colors.onSurfaceVariant, textAlign: 'right' },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest, gap: Spacing.sm, ...shadow2 },
  err: { ...Typography.caption, color: Colors.error, textAlign: 'center' },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  successIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  successMsg: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  successActions: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.md },
});
