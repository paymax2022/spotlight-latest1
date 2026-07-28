import React, { useState } from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { MapPin, CalendarDays, Users, FileText, CheckCircle2, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import QrCodeView from '@/components/QrCodeView';
import { useEvent, useRsvpEvent, useRegisterEvent, useSubmitEventFeedback } from '@/features/association/hooks/useCommunity';
import { formatDateTime, formatNaira } from '@/features/association/utils/associationFormatters';

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const rsvp = useRsvpEvent();
  const register = useRegisterEvent();
  const feedback = useSubmitEventFeedback(id as string);

  const [registered, setRegistered] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [rating, setRating] = useState(0);

  if (event.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Event" />
        <StateView kind="loading" message="Loading event…" />
      </SafeAreaView>
    );
  }
  if (event.isError || !event.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Event" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => event.refetch()} />
      </SafeAreaView>
    );
  }

  const e = event.data;
  const isPast = e.state === 'PAST';
  const isRegistered = e.registered || registered || register.isSuccess;
  const feedbackDone = e.feedbackSubmitted || feedback.isSuccess;

  const onRegister = () => {
    register.mutate(e.id, {
      onSuccess: () => setRegistered(true),
      onError: () => Alert.alert('Could not register', 'Please try again.'),
    });
  };

  const onSubmitFeedback = () => {
    if (rating === 0) return;
    feedback.mutate({ rating, comment: '' }, {
      onSuccess: () => { setShowFeedback(false); Alert.alert('Thank you', 'Your feedback was submitted.'); },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Event" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {e.coverUrl ? <Image source={{ uri: e.coverUrl }} style={styles.cover} /> : <View style={[styles.cover, styles.coverFallback]} />}

        <View style={styles.content}>
          <Text style={styles.title}>{e.title}</Text>

          <View style={[styles.card, shadow1]}>
            <Info icon={<CalendarDays size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} text={formatDateTime(e.startsAt)} />
            <Info icon={<MapPin size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} text={e.location} />
            <Info icon={<Users size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} text={`${e.attendeeCount} attending${e.capacity ? ` · ${e.capacity} capacity` : ''}`} />
          </View>

          <Text style={styles.body}>{e.description}</Text>
          <Text style={styles.organiser}>Organised by {e.organiser}</Text>

          {/* Ticket (registered) */}
          {isRegistered ? (
            <View style={styles.ticketCard}>
              <Text style={styles.ticketLabel}>Your ticket</Text>
              <QrCodeView payload={e.ticketCode} size={150} />
              <Text style={styles.ticketHint}>Present this QR at check-in</Text>
              {e.checkedIn ? (
                <View style={styles.checkedRow}>
                  <CheckCircle2 size={15} color={Colors.teal} strokeWidth={2.4} />
                  <Text style={styles.checkedText}>Checked in</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Documents */}
          {e.documents.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Documents</Text>
              <View style={styles.gap8}>
                {e.documents.map((d) => (
                  <Pressable key={d.id} style={[styles.docRow, shadow1]} accessibilityRole="button" accessibilityLabel={`Open ${d.name}`}>
                    <FileText size={18} color={Colors.secondary} strokeWidth={2} />
                    <Text style={styles.docName} numberOfLines={1}>{d.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {/* Feedback (past + registered) */}
          {isPast && isRegistered && !feedbackDone && showFeedback ? (
            <View style={[styles.card, shadow1]}>
              <Text style={styles.sectionTitle}>Rate this event</Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => setRating(n)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${n} star`}>
                    <Star size={30} color={n <= rating ? Colors.gold : Colors.outlineVariant} fill={n <= rating ? Colors.gold : 'transparent'} strokeWidth={2} />
                  </Pressable>
                ))}
              </View>
              <PrimaryButton label="Submit feedback" onPress={onSubmitFeedback} loading={feedback.isPending} disabled={rating === 0} />
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Footer CTA */}
      <View style={styles.footer}>
        {isPast ? (
          isRegistered && !feedbackDone && !showFeedback ? (
            <PrimaryButton label="Leave feedback" variant="secondary" onPress={() => setShowFeedback(true)} />
          ) : feedbackDone ? (
            <View style={styles.doneRow}><CheckCircle2 size={18} color={Colors.teal} strokeWidth={2.4} /><Text style={styles.doneText}>Feedback submitted</Text></View>
          ) : (
            <View style={styles.doneRow}><Text style={styles.doneText}>This event has ended</Text></View>
          )
        ) : isRegistered ? (
          <View style={styles.doneRow}><CheckCircle2 size={18} color={Colors.teal} strokeWidth={2.4} /><Text style={styles.doneText}>You’re registered</Text></View>
        ) : e.paid ? (
          <PrimaryButton label={`Register · ${formatNaira(e.feeKobo)}`} onPress={() => router.push(`/association/event-pay/${e.id}`)} />
        ) : (
          <View style={styles.footerBtns}>
            <PrimaryButton
              label={rsvp.variables?.rsvp === 'NOT_GOING' ? 'Not going' : "Can't go"}
              variant="secondary" fullWidth={false} style={styles.footerBtn}
              onPress={() => rsvp.mutate({ id: e.id, rsvp: 'NOT_GOING' })}
            />
            <PrimaryButton label="Register" fullWidth={false} style={styles.footerBtn} loading={register.isPending} onPress={onRegister} />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function Info({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.infoRow}>
      {icon}
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: 120 },
  cover: { width: '100%', height: 180 },
  coverFallback: { backgroundColor: Colors.surfaceContainerHigh },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, gap: Spacing.md },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  infoText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  body: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  organiser: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  ticketCard: { alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.lg },
  ticketLabel: { ...Typography.labelLg, color: Colors.onSurface },
  ticketHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  checkedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkedText: { ...Typography.labelMd, color: Colors.teal },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  gap8: { gap: Spacing.sm },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  docName: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  footerBtns: { flexDirection: 'row', gap: Spacing.sm },
  footerBtn: { flex: 1 },
  doneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  doneText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
});
