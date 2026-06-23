import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, Modal, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Star, Clock, CheckCircle2, Smile, X, ChevronRight, Award, TrendingUp, Lightbulb, PawPrint } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { router } from 'expo-router';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import { TeleHeader, RatingStars, DoctorAvatar } from '@/features/telemedicine/components';
import { SectionCard, StateView, ReviewCard, MetricTile } from '@/features/doctor/components';
import { useReputation, useReportReview, useQualityScore, useConsultationFeedback, useDisputeReview, useRequestReviewRemoval } from '@/features/doctor/hooks';
import {
  REVIEW_REPORT_REASONS,
  REVIEW_DISPUTE_REASON_OPTIONS,
  REVIEW_DISPUTE_REASON_LABELS,
  QUALITY_SCORE_GRADE_LABELS,
  QUALITY_SCORE_GRADE_TONES,
} from '@/features/doctor/constants';
import type { RatingBreakdown } from '@/types/doctor.phase2';
import type { ConsultationFeedback, ReviewDisputeReason } from '@/types/doctor.batch6';

type ReviewTab = 'patients' | 'vet';
const DISPUTE_LABELS = REVIEW_DISPUTE_REASON_OPTIONS.map((o) => o.label);

export default function ReviewsScreen() {
  const { data: reputation, isLoading, isError, refetch } = useReputation();
  const { data: quality } = useQualityScore();
  const { data: feedback = [] } = useConsultationFeedback();
  const report = useReportReview();
  const dispute = useDisputeReview();
  const removal = useRequestReviewRemoval();

  const [tab, setTab] = useState<ReviewTab>('patients');
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [disputeTarget, setDisputeTarget] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeDetail, setDisputeDetail] = useState('');

  const vetFeedback = useMemo(() => feedback.filter((f) => f.channel === 'vet'), [feedback]);

  const closeReport = () => { setReportTarget(null); setReportReason(''); };
  const submitReport = async () => {
    if (!reportTarget || !reportReason) { Alert.alert('Select a reason', 'Choose why this review is unfair.'); return; }
    try {
      await report.mutateAsync({ reviewId: reportTarget, reason: reportReason });
      Alert.alert('Reported', 'This review has been flagged for moderation.');
      closeReport();
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };

  const closeDispute = () => { setDisputeTarget(null); setDisputeReason(''); setDisputeDetail(''); };
  const submitRemoval = async () => {
    if (!disputeTarget || !disputeReason) { Alert.alert('Select a reason', 'Choose a reason before requesting removal.'); return; }
    const opt = REVIEW_DISPUTE_REASON_OPTIONS.find((o) => o.label === disputeReason);
    const reasonValue: ReviewDisputeReason = opt?.value ?? 'factually_incorrect';
    try {
      await removal.mutateAsync({ reviewId: disputeTarget, reason: disputeDetail.trim() || REVIEW_DISPUTE_REASON_LABELS[reasonValue] });
      Alert.alert('Removal requested', 'A removal request has been sent to moderation for review.');
      closeDispute();
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };
  const submitDispute = async () => {
    if (!disputeTarget || !disputeReason) { Alert.alert('Select a reason', 'Choose a dispute reason.'); return; }
    const opt = REVIEW_DISPUTE_REASON_OPTIONS.find((o) => o.label === disputeReason);
    const reasonValue: ReviewDisputeReason = opt?.value ?? 'factually_incorrect';
    try {
      const res = await dispute.mutateAsync({ reviewId: disputeTarget, reason: reasonValue, detail: disputeDetail.trim() || REVIEW_DISPUTE_REASON_LABELS[reasonValue] });
      Alert.alert('Dispute raised', `Dispute ${res.ref} is ${res.status}.`);
      closeDispute();
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Ratings & Reviews" />

      {isLoading && !reputation ? (
        <StateView variant="loading" label="Loading reviews" />
      ) : isError || !reputation ? (
        <StateView variant="error" message="We could not load your reviews." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Rating summary + breakdown */}
          <SectionCard style={styles.summary}>
            <View style={styles.summaryTop}>
              <Text style={styles.avg}>{reputation.averageRating.toFixed(1)}</Text>
              <View style={styles.summaryRight}>
                <RatingStars rating={reputation.averageRating} size={18} />
                <Text style={styles.total}>{reputation.totalReviews} reviews</Text>
              </View>
              {!!quality && (
                <Pressable style={[styles.gradePill, { backgroundColor: `${QUALITY_SCORE_GRADE_TONES[quality.grade]}1A` }]} onPress={() => router.push('/(doctor)/reviews/quality-score')} accessibilityRole="button" accessibilityLabel="View quality score">
                  <Text style={[styles.gradeScore, { color: QUALITY_SCORE_GRADE_TONES[quality.grade] }]}>{quality.scorePct}</Text>
                  <Text style={[styles.gradeLabel, { color: QUALITY_SCORE_GRADE_TONES[quality.grade] }]}>{QUALITY_SCORE_GRADE_LABELS[quality.grade]}</Text>
                </Pressable>
              )}
            </View>
            <View style={styles.breakdown}>
              {reputation.breakdown.map((b) => <BreakdownRow key={b.stars} item={b} total={reputation.totalReviews} />)}
            </View>
          </SectionCard>

          {/* Metric tiles */}
          <View style={styles.grid}>
            <MetricTile icon={Clock} label="Response time" value={`${reputation.metrics.avgResponseMins}m`} color={Colors.secondary} bg={Colors.iconBgBlue} />
            <MetricTile icon={CheckCircle2} label="Completion rate" value={`${reputation.metrics.completionRate}%`} color={Colors.teal} bg={Colors.iconBgTeal} />
            <MetricTile icon={Smile} label="Satisfaction" value={`${reputation.metrics.satisfactionScore}%`} color={Colors.primary} bg={Colors.iconBgPurple} />
          </View>

          {/* Reputation links */}
          <View style={styles.linkRow}>
            <RepLink icon={Award} label="Quality score" onPress={() => router.push('/(doctor)/reviews/quality-score')} />
            <RepLink icon={TrendingUp} label="Ranking" onPress={() => router.push('/(doctor)/reviews/ranking')} />
            <RepLink icon={Lightbulb} label="Improve" onPress={() => router.push('/(doctor)/reviews/improvements')} />
          </View>

          {/* Channel tabs */}
          <View style={styles.tabs}>
            <Pressable onPress={() => setTab('patients')} style={[styles.tab, tab === 'patients' && styles.tabActive]} accessibilityRole="button" accessibilityLabel="Patient reviews">
              <Text style={[styles.tabText, tab === 'patients' && styles.tabTextActive]}>Patient reviews</Text>
            </Pressable>
            <Pressable onPress={() => setTab('vet')} style={[styles.tab, tab === 'vet' && styles.tabActive]} accessibilityRole="button" accessibilityLabel="Vet client reviews">
              <Text style={[styles.tabText, tab === 'vet' && styles.tabTextActive]}>Vet clients</Text>
            </Pressable>
          </View>

          {tab === 'patients' ? (
            reputation.reviews.length === 0 ? (
              <StateView variant="empty" icon={Star} title="No reviews yet" message="Patient reviews will appear here." />
            ) : (
              <View style={styles.list}>
                {reputation.reviews.map((r) => (
                  <View key={r.id}>
                    <ReviewCard review={r} onReport={() => setReportTarget(r.id)} />
                    {!r.reported && (
                      <Pressable style={styles.disputeLink} onPress={() => setDisputeTarget(r.id)} accessibilityRole="button" accessibilityLabel="Dispute this review">
                        <Text style={styles.disputeLinkText}>Dispute review</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            )
          ) : (
            vetFeedback.length === 0 ? (
              <StateView variant="empty" icon={PawPrint} title="No vet client reviews" message="Vet client feedback will appear here." />
            ) : (
              <View style={styles.list}>
                {vetFeedback.map((f) => <FeedbackCard key={f.id} feedback={f} />)}
              </View>
            )
          )}
        </ScrollView>
      )}

      {/* Report sheet */}
      <Modal visible={!!reportTarget} transparent animationType="slide" onRequestClose={closeReport}>
        <Pressable style={styles.backdrop} onPress={closeReport} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Report review</Text>
            <Pressable onPress={closeReport} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close report dialog">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <SelectField label="Reason" placeholder="Select a reason" value={reportReason} options={REVIEW_REPORT_REASONS} onChange={setReportReason} searchable={false} />
          <PrimaryButton label="Submit report" onPress={submitReport} loading={report.isPending} style={styles.btn} />
        </View>
      </Modal>

      {/* Dispute sheet */}
      <Modal visible={!!disputeTarget} transparent animationType="slide" onRequestClose={closeDispute}>
        <Pressable style={styles.backdrop} onPress={closeDispute} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Dispute review</Text>
            <Pressable onPress={closeDispute} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close dispute dialog">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>
          <SelectField label="Reason" placeholder="Select a reason" value={disputeReason} options={DISPUTE_LABELS} onChange={setDisputeReason} searchable={false} />
          <TextInputField label="Detail" placeholder="Add supporting detail" value={disputeDetail} onChangeText={setDisputeDetail} multiline />
          <PrimaryButton label="Submit dispute" onPress={submitDispute} loading={dispute.isPending} style={styles.btn} />
          <PrimaryButton label="Request removal" onPress={submitRemoval} loading={removal.isPending} variant="secondary" style={styles.btn} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function FeedbackCard({ feedback: f }: { feedback: ConsultationFeedback }) {
  const date = new Date(f.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <View style={styles.fbCard}>
      <View style={styles.fbHeader}>
        <DoctorAvatar initials={f.patient.initials} color={f.patient.avatarColor} size={40} />
        <View style={styles.fbBody}>
          <Text style={styles.fbName} numberOfLines={1}>{f.patient.name}</Text>
          <Text style={styles.fbMeta}>{f.consultRef} · {date}</Text>
        </View>
        <RatingStars rating={f.rating} size={14} />
      </View>
      {!!f.comment && <Text style={styles.fbComment}>{f.comment}</Text>}
      {f.tags.length > 0 && (
        <View style={styles.tagRow}>
          {f.tags.map((t) => <View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>)}
        </View>
      )}
    </View>
  );
}

function RepLink({ icon: Icon, label, onPress }: { icon: typeof Award; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.repLink} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Icon size={18} color={Colors.primary} strokeWidth={2} />
      <Text style={styles.repLinkText} numberOfLines={1}>{label}</Text>
      <ChevronRight size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

function BreakdownRow({ item, total }: { item: RatingBreakdown; total: number }) {
  const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
  return (
    <View style={styles.breakRow}>
      <Text style={styles.breakStar}>{item.stars}</Text>
      <Star size={12} color={Colors.primary} fill={Colors.primary} strokeWidth={2} />
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.breakCount}>{item.count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  content:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  summary:      { marginBottom: Spacing.md },
  summaryTop:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  avg:          { ...Typography.displayLg, fontSize: 48, lineHeight: 52, color: Colors.onSurface },
  summaryRight: { gap: Spacing.xs, flex: 1 },
  total:        { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  gradePill:    { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.lg, alignItems: 'center' },
  gradeScore:   { ...Typography.headlineMd, fontWeight: '700' },
  gradeLabel:   { ...Typography.caption, fontWeight: '600' },
  breakdown:    { gap: Spacing.xs },
  breakRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  breakStar:    { ...Typography.labelSm, color: Colors.onSurfaceVariant, width: 10 },
  track:        { flex: 1, height: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, overflow: 'hidden' },
  fill:         { height: 8, borderRadius: Radius.full, backgroundColor: Colors.primary },
  breakCount:   { ...Typography.labelSm, color: Colors.onSurfaceVariant, width: 28, textAlign: 'right' },
  grid:         { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.md },
  linkRow:      { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  repLink:      { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  repLinkText:  { ...Typography.labelSm, color: Colors.onSurface, fontWeight: '600', flex: 1 },
  tabs:         { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  tab:          { flex: 1, height: 38, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  tabActive:    { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText:      { ...Typography.labelMd, color: Colors.onSurfaceVariant, fontWeight: '600' },
  tabTextActive:{ color: Colors.onPrimary },
  list:         { gap: Spacing.sm },
  disputeLink:  { alignSelf: 'flex-start', paddingTop: Spacing.xs, paddingHorizontal: Spacing.sm },
  disputeLinkText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' },
  fbCard:       { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.sm },
  fbHeader:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  fbBody:       { flex: 1, gap: 2 },
  fbName:       { ...Typography.labelLg, color: Colors.onSurface },
  fbMeta:       { ...Typography.caption, color: Colors.onSurfaceVariant },
  fbComment:    { ...Typography.bodyMd, color: Colors.onSurface },
  tagRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  tag:          { paddingHorizontal: 10, height: 26, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  tagText:      { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:        { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40 },
  sheetHandle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:   { ...Typography.titleMd, color: Colors.onSurface },
  btn:          { marginTop: Spacing.sm },
});
