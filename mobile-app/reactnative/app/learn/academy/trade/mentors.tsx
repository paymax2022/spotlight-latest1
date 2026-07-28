import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Star, Users, CheckCircle2, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { useMentors, useRequestMentor } from '@/features/academy/hooks';
import type { Mentor } from '@/features/academy/types';

/** S8 — Mentor connect (group/cohort matching). Child-safety: no 1:1 DMs. */
export default function MentorsScreen() {
  const mentors = useMentors();
  const request = useRequestMentor();
  if (mentors.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Finding mentors…" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Mentor connect" subtitle="Group mentorship & clinics" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.safetyNote}>
          <Users size={16} color={Colors.primary} />
          <Text style={styles.safetyText}>Mentorship happens in moderated groups and cohort clinics — there is no 1:1 private messaging, keeping younger learners safe.</Text>
        </View>
        {mentors.data?.map((m) => (
          <MentorCard key={m.id} m={m} busy={request.isPending} onRequest={() => request.mutate(m.id)} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function MentorCard({ m, busy, onRequest }: { m: Mentor; busy: boolean; onRequest: () => void }) {
  const initials = m.name.split(' ').map((w) => w[0]).join('').slice(0, 2);
  const bg = (Colors as unknown as Record<string, string>)[m.avatarColorKey] ?? Colors.iconBgPurple;
  return (
    <View style={[styles.card, shadow1]}>
      <View style={styles.top}>
        <View style={[styles.avatar, { backgroundColor: bg }]}><Text style={styles.avatarText}>{initials}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{m.name}</Text>
          <Text style={styles.headline}>{m.headline}</Text>
          <View style={styles.ratingRow}>
            <Star size={13} color={Colors.gold} fill={Colors.gold} />
            <Text style={styles.rating}>{m.rating.toFixed(1)}</Text>
            <Chip label="Group only" color={Colors.teal} bg={Colors.iconBgTeal} small />
          </View>
        </View>
      </View>
      <Text style={styles.bio}>{m.bio}</Text>
      {m.requestState === 'matched' ? (
        <View style={styles.stateRow}><CheckCircle2 size={16} color={Colors.teal} /><Text style={styles.matchedText}>Matched · join the cohort</Text></View>
      ) : m.requestState === 'requested' ? (
        <View style={styles.stateRow}><Clock size={16} color={Colors.onWarning} /><Text style={styles.pendingText}>Request sent — you will be placed in a cohort</Text></View>
      ) : (
        <PrimaryButton label="Request mentorship" onPress={onRequest} loading={busy} variant="secondary" style={{ marginTop: Spacing.sm }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  safetyNote: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.cardPadding, marginBottom: Spacing.xs },
  safetyText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: 6 },
  top: { flexDirection: 'row', gap: Spacing.sm },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleMd, color: Colors.primary, fontWeight: '700' },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  headline: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  rating: { ...Typography.labelMd, color: Colors.onSurface, fontWeight: '700' },
  bio: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
  matchedText: { ...Typography.labelMd, color: Colors.teal, fontWeight: '700' },
  pendingText: { ...Typography.labelMd, color: Colors.onWarning, fontWeight: '700', flex: 1 },
});
