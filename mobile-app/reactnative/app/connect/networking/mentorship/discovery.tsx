import React, { useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { UserPlus, Clock, UserCheck, Users, ChevronRight, Briefcase } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useMentorDiscovery } from '@/features/connect/networking/mentorship/hooks';
import { MENTORSHIP_DOMAINS } from '@/features/connect/networking/mentorship/api';
import { AssessedSkillBadge } from '@/features/connect/networking/assessments/AssessedSkillBadge';
import type { MentorProfile } from '@/features/connect/networking/mentorship/types';

/**
 * MN-02 — Mentor discovery. Browse/filter mentors by domain. The payload is
 * professional-only (PN-7 — no dating-mode signals). Assessed skills render with
 * the distinct verified badge (PN-5) including the assessment version (PN-12).
 */
export default function MentorDiscoveryScreen() {
  const [domain, setDomain] = useState<string | null>(null);
  const q = useMentorDiscovery(domain ?? undefined);
  const mentors = q.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Find a mentor"
        rightSlot={
          <Pressable hitSlop={8} onPress={() => router.push('/connect/networking/mentorship/opt-in')} accessibilityLabel="Mentorship opt-in">
            <Text style={styles.optInLink}>Opt in</Text>
          </Pressable>
        }
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        <FilterChip label="All" active={domain === null} onPress={() => setDomain(null)} />
        {MENTORSHIP_DOMAINS.map((d) => (
          <FilterChip key={d} label={d} active={domain === d} onPress={() => setDomain(d)} />
        ))}
      </ScrollView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {q.isLoading ? (
          <StateView kind="loading" message="Finding mentors…" />
        ) : q.isError ? (
          <StateView kind="error" title="Couldn't load mentors" message="Please try again." actionLabel="Retry" onAction={() => q.refetch()} />
        ) : mentors.length === 0 ? (
          <StateView kind="empty" icon="Users" title="No mentors here" message="Try another domain." />
        ) : (
          mentors.map((m) => <MentorCard key={m.id} mentor={m} />)
        )}
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.filterChip, active && styles.filterChipActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function MatchStatus({ mentor }: { mentor: MentorProfile }) {
  switch (mentor.matchState) {
    case 'accepted':
      return (
        <View style={[styles.statusPill, styles.statusOk]}>
          <UserCheck size={14} color={ConnectColors.ok} strokeWidth={2.2} />
          <Text style={[styles.statusText, { color: ConnectColors.ok }]}>Matched</Text>
        </View>
      );
    case 'requested':
      return (
        <View style={[styles.statusPill, styles.statusMuted]}>
          <Clock size={14} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
          <Text style={[styles.statusText, { color: Colors.onSurfaceVariant }]}>Requested</Text>
        </View>
      );
    case 'declined':
      return (
        <View style={[styles.statusPill, styles.statusMuted]}>
          <Text style={[styles.statusText, { color: Colors.onSurfaceVariant }]}>Declined</Text>
        </View>
      );
    default:
      return (
        <View style={[styles.statusPill, styles.statusPrimary]}>
          <UserPlus size={14} color={Colors.onPrimary} strokeWidth={2.2} />
          <Text style={[styles.statusText, { color: Colors.onPrimary }]}>Request</Text>
        </View>
      );
  }
}

function MentorCard({ mentor: m }: { mentor: MentorProfile }) {
  const full = m.availableSlots <= 0;
  return (
    <Pressable
      style={styles.card}
      accessibilityRole="button"
      onPress={() => router.push(`/connect/networking/mentorship/match/${encodeURIComponent(m.id)}`)}
    >
      <View style={styles.cardTop}>
        {m.avatarUrl ? (
          <Image source={{ uri: m.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}><Users size={22} color={Colors.onSurfaceVariant} /></View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{m.displayName}</Text>
          <Text style={styles.headline} numberOfLines={1}>{m.headline}</Text>
          {m.company ? (
            <View style={styles.compRow}>
              <Briefcase size={11} color={Colors.onSurfaceVariant} />
              <Text style={styles.company} numberOfLines={1}>{m.occupation} · {m.company}</Text>
            </View>
          ) : null}
        </View>
        <ChevronRight size={18} color={Colors.onSurfaceVariant} />
      </View>

      {m.assessedSkills.length ? (
        <View style={styles.skillRow}>
          {m.assessedSkills.map((s) => (
            <AssessedSkillBadge key={s.skill} skill={s.skill} assessmentVersion={s.assessmentVersion} />
          ))}
        </View>
      ) : null}

      <View style={styles.cardFooter}>
        <Text style={[styles.slots, full && { color: Colors.error }]}>
          {full ? 'No open slots' : `${m.availableSlots} of ${m.capacity} slots open`}
        </Text>
        <MatchStatus mentor={m} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  optInLink: { ...Typography.labelMd, color: ConnectColors.brand, fontWeight: '700' },
  filterRow: { gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md },
  filterChip: { paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
  filterChipActive: { backgroundColor: ConnectColors.brand, borderColor: ConnectColors.brand },
  filterChipText: { ...Typography.labelMd, color: Colors.onSurface },
  filterChipTextActive: { color: Colors.onPrimary, fontWeight: '700' },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.cardPadding, gap: Spacing.sm },
  cardTop: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  avatar: { width: 52, height: 52, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  headline: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  compRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  company: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  skillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: 2 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs },
  slots: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full },
  statusPrimary: { backgroundColor: ConnectColors.brand },
  statusMuted: { backgroundColor: Colors.surfaceContainerHigh },
  statusOk: { backgroundColor: Colors.iconBgTeal },
  statusText: { ...Typography.labelMd, fontWeight: '700' },
});
