import React, { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Users, ShieldCheck, Check, X, Briefcase, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useMentor, useRequestMentorshipMatch, useRespondMentorshipMatch } from '@/features/connect/networking/mentorship/hooks';
import { AssessedSkillBadge } from '@/features/connect/networking/assessments/AssessedSkillBadge';

/**
 * MN-03 — Match request. Send a mentorship request to a mentor (as a mentee) and,
 * for an in-flight request, accept/decline it (the counterpart response step). A
 * request never opens a thread on its own — it must be accepted first.
 */
export default function MentorshipMatchScreen() {
  const { mentorId } = useLocalSearchParams<{ mentorId: string }>();
  const id = String(mentorId ?? '');

  const q = useMentor(id);
  const mentor = q.data;

  const [domain, setDomain] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [matchId, setMatchId] = useState<string | null>(null);

  const request = useRequestMentorshipMatch();
  const respond = useRespondMentorshipMatch();

  // Default the domain to the mentor's first domain once loaded.
  useEffect(() => {
    if (mentor && domain === null) setDomain(mentor.domains[0] ?? null);
  }, [mentor, domain]);

  if (q.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Request mentorship" />
        <StateView kind="loading" message="Loading mentor…" />
      </SafeAreaView>
    );
  }
  if (q.isError || !mentor) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Request mentorship" />
        <StateView kind="error" title="Couldn't load mentor" message="Please try again." actionLabel="Retry" onAction={() => q.refetch()} />
      </SafeAreaView>
    );
  }

  const state = mentor.matchState;
  const full = mentor.availableSlots <= 0;

  function send() {
    request.mutate(
      { mentorId: id, domain: domain ?? mentor!.domains[0] ?? '', message: message.trim() },
      { onSuccess: (m) => setMatchId(m.id) },
    );
  }

  function respondTo(action: 'accept' | 'decline') {
    respond.mutate({ matchId: matchId ?? `match_${id}`, action, mentorId: id });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Request mentorship" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Mentor summary — professional fields only (PN-7) */}
        <View style={styles.head}>
          {mentor.avatarUrl ? (
            <Image source={{ uri: mentor.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}><Users size={26} color={Colors.onSurfaceVariant} /></View>
          )}
          <Text style={styles.name}>{mentor.displayName}</Text>
          <Text style={styles.headline}>{mentor.headline}</Text>
          {mentor.company ? (
            <View style={styles.compRow}>
              <Briefcase size={12} color={Colors.onSurfaceVariant} />
              <Text style={styles.company}>{mentor.occupation} · {mentor.company}</Text>
            </View>
          ) : null}
          {typeof mentor.yearsExperience === 'number' ? (
            <Text style={styles.years}>{mentor.yearsExperience} yrs experience</Text>
          ) : null}
        </View>

        {mentor.bio ? <Text style={styles.bio}>{mentor.bio}</Text> : null}

        {mentor.assessedSkills.length ? (
          <>
            <Text style={styles.label}>Verified skills</Text>
            <View style={styles.skillRow}>
              {mentor.assessedSkills.map((s) => (
                <AssessedSkillBadge key={s.skill} skill={s.skill} assessmentVersion={s.assessmentVersion} />
              ))}
            </View>
          </>
        ) : null}

        {/* State-driven body */}
        {state === 'accepted' ? (
          <View style={[styles.banner, styles.bannerOk]}>
            <ShieldCheck size={18} color={ConnectColors.ok} />
            <Text style={styles.bannerText}>You're matched. A mentorship thread is now open in Messages.</Text>
          </View>
        ) : state === 'declined' ? (
          <View style={[styles.banner, styles.bannerMuted]}>
            <Text style={styles.bannerText}>This request was declined. You can explore other mentors.</Text>
          </View>
        ) : state === 'requested' ? (
          <>
            <View style={[styles.banner, styles.bannerMuted]}>
              <Clock size={18} color={Colors.onSurfaceVariant} />
              <Text style={styles.bannerText}>Request pending. It opens a thread only once accepted.</Text>
            </View>
            {/* Counterpart response step (accept / decline) */}
            <Text style={styles.label}>Respond to request</Text>
            <View style={styles.respondRow}>
              <Pressable style={[styles.respondBtn, styles.declineBtn]} onPress={() => respondTo('decline')} disabled={respond.isPending} accessibilityRole="button">
                <X size={18} color={Colors.error} />
                <Text style={[styles.respondText, { color: Colors.error }]}>Decline</Text>
              </Pressable>
              <Pressable style={[styles.respondBtn, styles.acceptBtn]} onPress={() => respondTo('accept')} disabled={respond.isPending} accessibilityRole="button">
                <Check size={18} color={Colors.onPrimary} />
                <Text style={[styles.respondText, { color: Colors.onPrimary }]}>Accept</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.label}>Domain</Text>
            <View style={styles.chipWrap}>
              {mentor.domains.map((d) => {
                const active = domain === d;
                return (
                  <Pressable key={d} onPress={() => setDomain(d)} style={[styles.chip, active && styles.chipActive]} accessibilityState={{ selected: active }}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{d}</Text>
                  </Pressable>
                );
              })}
            </View>

            <TextInputField
              label="Message (optional)"
              value={message}
              onChangeText={setMessage}
              placeholder="Share what you'd like help with…"
              multiline
              numberOfLines={5}
              maxLength={400}
              style={styles.noteInput}
            />

            {full ? <Text style={styles.warn}>This mentor has no open slots — your request may wait.</Text> : null}
            {request.isError ? <Text style={styles.error}>Couldn't send your request. Please try again.</Text> : null}

            <View style={{ height: Spacing.md }} />
            <PrimaryButton label="Send request" onPress={send} loading={request.isPending} />
          </>
        )}

        <View style={{ height: Spacing.md }} />
        <PrimaryButton label="Back to mentors" variant="ghost" onPress={() => router.replace('/connect/networking/mentorship/discovery')} />
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  head: { alignItems: 'center', gap: 3 },
  avatar: { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.xs },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.headlineMd, color: Colors.onSurface },
  headline: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  compRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  company: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  years: { ...Typography.labelSm, color: Colors.secondary, marginTop: 2 },
  bio: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: Spacing.lg, lineHeight: 20 },
  label: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  skillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 8, backgroundColor: Colors.surfaceContainerLowest },
  chipActive: { backgroundColor: ConnectColors.brand, borderColor: ConnectColors.brand },
  chipText: { ...Typography.labelMd, color: Colors.onSurface },
  chipTextActive: { color: Colors.onPrimary, fontWeight: '700' },
  noteInput: { minHeight: 110, textAlignVertical: 'top' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.lg },
  bannerOk: { backgroundColor: Colors.iconBgTeal },
  bannerMuted: { backgroundColor: Colors.surfaceContainerLow },
  bannerText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  respondRow: { flexDirection: 'row', gap: Spacing.sm },
  respondBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: Radius.lg },
  declineBtn: { borderWidth: 1.5, borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  acceptBtn: { backgroundColor: ConnectColors.brand },
  respondText: { ...Typography.labelLg, fontWeight: '700' },
  warn: { ...Typography.labelSm, color: Colors.onWarning, marginTop: Spacing.sm },
  error: { ...Typography.labelMd, color: Colors.error, marginTop: Spacing.sm },
});
