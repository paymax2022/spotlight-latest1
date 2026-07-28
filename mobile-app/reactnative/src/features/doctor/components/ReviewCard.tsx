import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Flag } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { DoctorAvatar, RatingStars } from '@/features/telemedicine/components';
import type { DoctorReview } from '@/types/doctor.phase2';

interface Props {
  review:    DoctorReview;
  onReport?: () => void;
}

// New component: a patient review card (avatar + stars + comment + reply +
// report action) for the ratings/reviews screen (#8). No existing row renders a
// free-text review with an inline report action, so this is genuinely new.
export default function ReviewCard({ review, onReport }: Props) {
  const date = new Date(review.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <DoctorAvatar initials={review.patient.initials} color={review.patient.avatarColor} size={40} />
        <View style={styles.headerBody}>
          <Text style={styles.name} numberOfLines={1}>{review.patient.name}</Text>
          <Text style={styles.meta}>{review.consultType} · {date}</Text>
        </View>
        <RatingStars rating={review.rating} size={14} />
      </View>

      {!!review.comment && <Text style={styles.comment}>{review.comment}</Text>}

      {!!review.doctorReply && (
        <View style={styles.reply}>
          <Text style={styles.replyLabel}>Your reply</Text>
          <Text style={styles.replyText}>{review.doctorReply}</Text>
        </View>
      )}

      {review.reported ? (
        <View style={styles.reportedTag}>
          <Flag size={12} color={Colors.error} strokeWidth={2} />
          <Text style={styles.reportedText}>Reported as unfair</Text>
        </View>
      ) : (
        !!onReport && (
          <Pressable onPress={onReport} style={styles.reportBtn} accessibilityRole="button" accessibilityLabel="Report this review">
            <Flag size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.reportBtnText}>Report as unfair</Text>
          </Pressable>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card:         { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: Spacing.sm },
  header:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerBody:   { flex: 1, gap: 2 },
  name:         { ...Typography.labelLg, color: Colors.onSurface },
  meta:         { ...Typography.caption, color: Colors.onSurfaceVariant, textTransform: 'capitalize' },
  comment:      { ...Typography.bodyMd, color: Colors.onSurface },
  reply:        { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm, gap: 2 },
  replyLabel:   { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' },
  replyText:    { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  reportedTag:  { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', height: 26, paddingHorizontal: 10, borderRadius: Radius.full, backgroundColor: Colors.errorContainer },
  reportedText: { ...Typography.labelSm, color: Colors.error, fontWeight: '600' },
  reportBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  reportBtnText:{ ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '600' },
});
