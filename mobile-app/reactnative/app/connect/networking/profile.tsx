import React from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Users,
  UserPlus,
  UserCheck,
  Clock,
  Award,
  ChevronRight,
  Building2,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useNetworkProfile } from '@/features/connect/networking/hooks';
import DiscoveryVerifiedBadges from '@/features/connect/components/discovery-VerifiedBadges';
import DiscoveryChipRow from '@/features/connect/components/discovery-ChipRow';
import type { NetworkProfile } from '@/features/connect/networking/types';

/**
 * Network profile detail (PRD §10.3). Bottom sticky action follows the
 * request-to-connect lifecycle (SAFETY §5 — "Connect" never opens a thread).
 * distanceLabel is approximate copy only (SAFETY §3).
 */
export default function NetworkProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const profileId = String(id ?? '');
  const profileQuery = useNetworkProfile(profileId);
  const profile = profileQuery.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Profile" />
      {profileQuery.isLoading ? (
        <StateView kind="loading" message="Loading profile…" />
      ) : profileQuery.isError ? (
        <StateView
          kind="error"
          icon="CloudOff"
          title="Couldn't load profile"
          message="Something went wrong."
          actionLabel="Retry"
          onAction={() => profileQuery.refetch()}
        />
      ) : !profile ? (
        <StateView kind="empty" icon="Users" title="Profile not found" />
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <View style={styles.header}>
              {profile.photos[0] ? (
                <Image source={{ uri: profile.photos[0] }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Users size={32} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
                </View>
              )}
              <Text style={styles.name}>{profile.displayName}</Text>
              <Text style={styles.headline}>{profile.headline}</Text>
              <View style={styles.occRow}>
                <Building2 size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={styles.occupation}>
                  {profile.occupation}
                  {profile.company ? ` · ${profile.company}` : ''}
                </Text>
              </View>
              <Text style={styles.distance}>{profile.distanceLabel}</Text>
            </View>

            <View style={styles.badgesWrap}>
              <DiscoveryVerifiedBadges flags={profile.verified} />
            </View>

            {profile.bio ? (
              <Section title="About">
                <Text style={styles.bio}>{profile.bio}</Text>
              </Section>
            ) : null}

            {profile.openTo.length ? (
              <Section title="Open to">
                <DiscoveryChipRow items={profile.openTo} variant="static" />
              </Section>
            ) : null}

            {profile.skills.length ? (
              <Section title="Skills">
                <DiscoveryChipRow items={profile.skills} variant="static" />
              </Section>
            ) : null}

            {profile.interests.length ? (
              <Section title="Interests">
                <DiscoveryChipRow items={profile.interests} variant="static" />
              </Section>
            ) : null}

            <View style={styles.metaRow}>
              <Text style={styles.meta}>
                {profile.mutualConnections} mutual connection{profile.mutualConnections === 1 ? '' : 's'}
              </Text>
            </View>

            <Pressable
              style={styles.endorseRow}
              accessibilityRole="button"
              onPress={() =>
                router.push(`/connect/networking/endorsements?id=${encodeURIComponent(profile.id)}`)
              }
            >
              <View style={styles.endorseIcon}>
                <Award size={18} color={ConnectColors.warn} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.endorseLabel}>Endorsements</Text>
                <Text style={styles.endorseSub}>{profile.endorsements} total</Text>
              </View>
              <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>

            <View style={{ height: Spacing.xxl }} />
          </ScrollView>

          <View style={styles.sticky}>
            <StickyAction profile={profile} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function StickyAction({ profile }: { profile: NetworkProfile }) {
  switch (profile.connectionState) {
    case 'connected':
      return (
        <View style={[styles.stickyBtn, styles.stickyConnected]}>
          <UserCheck size={18} color={ConnectColors.ok} strokeWidth={2.2} />
          <Text style={[styles.stickyText, { color: ConnectColors.ok }]}>Connected</Text>
        </View>
      );
    case 'requested':
      return (
        <View style={[styles.stickyBtn, styles.stickyMuted]}>
          <Clock size={18} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
          <Text style={[styles.stickyText, { color: Colors.onSurfaceVariant }]}>Requested</Text>
        </View>
      );
    case 'incoming':
      return (
        <Pressable
          style={[styles.stickyBtn, styles.stickyPrimary]}
          accessibilityRole="button"
          onPress={() => router.push('/connect/messaging/connection-requests')}
        >
          <UserCheck size={18} color={Colors.onPrimary} strokeWidth={2.2} />
          <Text style={[styles.stickyText, { color: Colors.onPrimary }]}>Respond to request</Text>
        </Pressable>
      );
    case 'none':
    default:
      return (
        <Pressable
          style={[styles.stickyBtn, styles.stickyPrimary]}
          accessibilityRole="button"
          onPress={() =>
            router.push(
              `/connect/networking/connect-request?id=${encodeURIComponent(profile.id)}&name=${encodeURIComponent(profile.displayName)}`,
            )
          }
        >
          <UserPlus size={18} color={Colors.onPrimary} strokeWidth={2.2} />
          <Text style={[styles.stickyText, { color: Colors.onPrimary }]}>Connect</Text>
        </Pressable>
      );
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin },
  header: { alignItems: 'center', gap: 4, paddingTop: Spacing.sm },
  avatar: { width: 96, height: 96, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.headlineMd, color: Colors.onSurface },
  headline: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  occRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  occupation: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  distance: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  badgesWrap: { alignItems: 'center', marginTop: Spacing.md },
  section: { marginTop: Spacing.lg, gap: Spacing.sm },
  sectionTitle: { ...Typography.labelLg, color: Colors.onSurface, fontWeight: '700' },
  bio: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  metaRow: { marginTop: Spacing.lg },
  meta: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  endorseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
    marginTop: Spacing.lg,
  },
  endorseIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgGold,
  },
  endorseLabel: { ...Typography.labelLg, color: Colors.onSurface },
  endorseSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  sticky: {
    paddingHorizontal: Spacing.containerMargin,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
  stickyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 56,
    borderRadius: Radius.lg,
  },
  stickyPrimary: { backgroundColor: ConnectColors.brand },
  stickyMuted: { backgroundColor: Colors.surfaceContainerHigh },
  stickyConnected: { backgroundColor: Colors.iconBgTeal },
  stickyText: { ...Typography.labelLg, fontWeight: '700' },
});
