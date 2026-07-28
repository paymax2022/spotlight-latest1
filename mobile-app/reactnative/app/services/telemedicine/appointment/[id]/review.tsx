import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircle2 } from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { getAppointment, submitReview, DEMO_APPOINTMENTS } from '@/api/telemedicine.api';
import { getErrorMessage } from '@/utils/errorMapper';
import { TeleHeader, DoctorAvatar, RatingStars } from '@/features/telemedicine/components';
import PrimaryButton from '@/components/PrimaryButton';

const QUICK_TAGS = ['Great listener', 'On time', 'Clear advice', 'Professional', 'Caring', 'Knowledgeable'];

const RATING_LABEL: Record<number, string> = {
  0: 'Tap a star to rate',
  1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very good', 5: 'Excellent',
};

export default function ReviewScreen() {
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const { data: appt } = useQuery({
    queryKey: ['tele-appointment', id],
    queryFn:  () => getAppointment(String(id)),
    placeholderData: DEMO_APPOINTMENTS.find((a) => a.id === id),
  });

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => submitReview({ appointmentId: String(id), rating, comment: [...tags, comment].filter(Boolean).join('. ') }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tele-doctor', appt?.doctor.id] });
      setDone(true);
    },
  });

  const toggleTag = (t: string) => setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Thank you" />
        <View style={styles.doneWrap}>
          <CheckCircle2 size={64} color={Colors.teal} strokeWidth={1.8} />
          <Text style={styles.doneTitle}>Review submitted</Text>
          <Text style={styles.doneSub}>Thanks for helping other patients find great care.</Text>
          <PrimaryButton label="Back to appointments" onPress={() => router.replace('/services/telemedicine/appointments')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Rate Your Visit" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={[styles.docCard, shadow1]}>
          {appt && <DoctorAvatar initials={appt.doctor.initials} color={appt.doctor.avatarColor} size={64} />}
          <Text style={styles.docName}>{appt?.doctor.name ?? 'Your doctor'}</Text>
          <Text style={styles.docSpec}>{appt?.doctor.specialties.join(' • ')}</Text>
        </View>

        <View style={styles.ratingWrap}>
          <RatingStars rating={rating} size={40} editable onChange={setRating} />
          <Text style={styles.ratingLabel}>{RATING_LABEL[rating]}</Text>
        </View>

        <Text style={styles.sectionTitle}>What stood out?</Text>
        <View style={styles.tagWrap}>
          {QUICK_TAGS.map((t) => {
            const active = tags.includes(t);
            return (
              <Text key={t} onPress={() => toggleTag(t)} style={[styles.tag, active && styles.tagActive]}>{t}</Text>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { marginTop: Spacing.lg }]}>Add a comment (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Share more about your experience"
          placeholderTextColor={Colors.outline}
          value={comment}
          onChangeText={setComment}
          multiline
          textAlignVertical="top"
        />
        {error ? <Text style={styles.errorText}>{getErrorMessage(error)}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Submit review" onPress={() => mutate()} loading={isPending} disabled={rating === 0} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: 120 },
  docCard:     { alignItems: 'center', gap: 4, padding: Spacing.lg, borderRadius: Radius.xl, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  docName:     { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.sm },
  docSpec:     { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  ratingWrap:  { alignItems: 'center', gap: Spacing.sm, marginVertical: Spacing.xl },
  ratingLabel: { ...Typography.titleMd, color: Colors.primary },
  sectionTitle:{ ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.md },
  tagWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tag:         { ...Typography.labelMd, color: Colors.onSurface, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, overflow: 'hidden', backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  tagActive:   { color: Colors.onPrimary, backgroundColor: Colors.primary, borderColor: Colors.primary },
  input:       { minHeight: 110, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderRadius: Radius.lg, padding: Spacing.md, ...Typography.bodyMd, color: Colors.onSurface, backgroundColor: Colors.surfaceContainerLow },
  errorText:   { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.sm },
  footer:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 32 : Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  doneWrap:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  doneTitle:   { ...Typography.headlineMd, color: Colors.onSurface },
  doneSub:     { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.lg },
});
