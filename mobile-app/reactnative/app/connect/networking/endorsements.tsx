import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Award, ThumbsUp, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useEndorsements, useEndorseSkill } from '@/features/connect/networking/hooks';
import type { EndorsableSkill, Endorsement } from '@/features/connect/networking/types';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

/** Skill endorsements (PRD §10.3 NW-11). */
export default function EndorsementsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const profileId = String(id ?? '');
  const endorsementsQuery = useEndorsements(profileId);

  const data = endorsementsQuery.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Endorsements" />
      {endorsementsQuery.isLoading ? (
        <StateView kind="loading" message="Loading endorsements…" />
      ) : endorsementsQuery.isError ? (
        <StateView
          kind="error"
          icon="CloudOff"
          title="Couldn't load endorsements"
          message="Something went wrong."
          actionLabel="Retry"
          onAction={() => endorsementsQuery.refetch()}
        />
      ) : !data || (data.skills.length === 0 && data.recent.length === 0) ? (
        <StateView
          kind="empty"
          icon="Award"
          title="No endorsements yet"
          message="Skills endorsed by connections will appear here."
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Text style={styles.sectionTitle}>Skills</Text>
          <View style={styles.skills}>
            {data.skills.map((skill) => (
              <SkillRow key={skill.skill} profileId={profileId} skill={skill} />
            ))}
          </View>

          {data.recent.length ? (
            <>
              <Text style={[styles.sectionTitle, styles.recentTitle]}>Recent endorsements</Text>
              <View style={styles.recent}>
                {data.recent.map((e) => (
                  <RecentRow key={e.id} endorsement={e} />
                ))}
              </View>
            </>
          ) : null}

          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SkillRow({ profileId, skill }: { profileId: string; skill: EndorsableSkill }) {
  const endorse = useEndorseSkill(profileId);
  const endorsed = skill.endorsedByViewer;

  return (
    <View style={styles.skillRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.skillName}>{skill.skill}</Text>
        <Text style={styles.skillCount}>
          {skill.count} endorsement{skill.count === 1 ? '' : 's'}
        </Text>
      </View>
      <Pressable
        style={[styles.endorseBtn, endorsed ? styles.endorsedBtn : styles.endorseBtnActive]}
        accessibilityRole="button"
        disabled={endorsed || endorse.isPending}
        onPress={() => endorse.mutate(skill.skill)}
      >
        {endorsed ? (
          <>
            <CircleCheck size={15} color={ConnectColors.ok} strokeWidth={2.2} />
            <Text style={[styles.endorseText, { color: ConnectColors.ok }]}>Endorsed</Text>
          </>
        ) : (
          <>
            <ThumbsUp size={15} color={Colors.onPrimary} strokeWidth={2.2} />
            <Text style={[styles.endorseText, { color: Colors.onPrimary }]}>Endorse</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

function RecentRow({ endorsement }: { endorsement: Endorsement }) {
  return (
    <View style={styles.recentRow}>
      <View style={styles.recentIcon}>
        <Award size={18} color={ConnectColors.warn} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.recentText}>
          <Text style={styles.recentName}>{endorsement.endorserName}</Text> endorsed{' '}
          <Text style={styles.recentSkill}>{endorsement.skill}</Text>
        </Text>
        <Text style={styles.recentTime}>{relativeTime(endorsement.endorsedAt)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  sectionTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700', marginBottom: Spacing.sm },
  recentTitle: { marginTop: Spacing.lg },
  skills: { gap: Spacing.sm },
  skillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
  },
  skillName: { ...Typography.labelLg, color: Colors.onSurface },
  skillCount: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  endorseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 9,
    borderRadius: Radius.full,
  },
  endorseBtnActive: { backgroundColor: ConnectColors.brand },
  endorsedBtn: { backgroundColor: Colors.iconBgTeal },
  endorseText: { ...Typography.labelMd, fontWeight: '700' },
  recent: { gap: Spacing.sm },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  recentIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgGold,
  },
  recentText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  recentName: { color: Colors.onSurface, fontWeight: '700' },
  recentSkill: { color: ConnectColors.brand, fontWeight: '700' },
  recentTime: { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: 2 },
});
