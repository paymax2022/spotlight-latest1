import React, { useMemo, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  SlidersHorizontal,
  Users,
  Calendar,
  UserPlus,
  UserCheck,
  Clock,
  ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SearchBar from '@/components/SearchBar';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useNetworkFeed } from '@/features/connect/networking/hooks';
import DiscoveryVerifiedBadges from '@/features/connect/components/discovery-VerifiedBadges';
import DiscoveryChipRow from '@/features/connect/components/discovery-ChipRow';
import type { NetworkFilters, NetworkProfile } from '@/features/connect/networking/types';

const BASE_FILTERS: Omit<NetworkFilters, 'query'> = {
  maxDistanceKm: 50,
  verifiedOnly: false,
  skills: [],
  openTo: [],
};

/**
 * Networking home (PRD §10.3 NW-01). Search drives the local query; the right
 * action on each card reflects the request-to-connect lifecycle (SAFETY §5 —
 * "Connect" opens the note composer, never a thread).
 */
export default function NetworkFeedScreen() {
  const [query, setQuery] = useState('');

  const filters: NetworkFilters = useMemo(() => ({ ...BASE_FILTERS, query }), [query]);
  const feedQuery = useNetworkFeed(filters);

  const profiles = feedQuery.data ?? [];

  function renderBody() {
    if (feedQuery.isLoading) {
      return <StateView kind="loading" message="Finding people near you…" />;
    }
    if (feedQuery.isError) {
      return (
        <StateView
          kind="error"
          icon="CloudOff"
          title="Couldn't load your network"
          message="Something went wrong fetching people."
          actionLabel="Retry"
          onAction={() => feedQuery.refetch()}
        />
      );
    }
    if (profiles.length === 0) {
      return (
        <StateView
          kind="empty"
          icon="Users"
          title="No one to show yet"
          message="Try clearing your search or adjusting filters."
        />
      );
    }
    return (
      <View style={styles.list}>
        {profiles.map((p) => (
          <ProfileCard key={p.id} profile={p} />
        ))}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Network"
        rightSlot={
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Filters"
            onPress={() => router.push('/connect/networking/filters')}
          >
            <SlidersHorizontal size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <SearchBar
          placeholder="Search people, roles, companies…"
          value={query}
          onChangeText={setQuery}
        />

        <View style={styles.entryRow}>
          <EntryCard
            icon={<Users size={20} color={ConnectColors.brand} strokeWidth={2} />}
            label="Communities"
            onPress={() => router.push('/connect/networking/communities')}
          />
          <EntryCard
            icon={<Calendar size={20} color={ConnectColors.brand} strokeWidth={2} />}
            label="Events"
            onPress={() => router.push('/connect/networking/events')}
          />
        </View>

        {renderBody()}
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function EntryCard({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.entryCard} onPress={onPress} accessibilityRole="button">
      <View style={styles.entryIcon}>{icon}</View>
      <Text style={styles.entryLabel}>{label}</Text>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

function ConnectAction({ profile }: { profile: NetworkProfile }) {
  switch (profile.connectionState) {
    case 'connected':
      return (
        <View style={[styles.actionBtn, styles.actionConnected]}>
          <UserCheck size={16} color={ConnectColors.ok} strokeWidth={2.2} />
          <Text style={[styles.actionText, { color: ConnectColors.ok }]}>Connected</Text>
        </View>
      );
    case 'requested':
      return (
        <View style={[styles.actionBtn, styles.actionMuted]}>
          <Clock size={16} color={Colors.onSurfaceVariant} strokeWidth={2.2} />
          <Text style={[styles.actionText, { color: Colors.onSurfaceVariant }]}>Requested</Text>
        </View>
      );
    case 'incoming':
      return (
        <Pressable
          style={[styles.actionBtn, styles.actionPrimary]}
          accessibilityRole="button"
          onPress={() => router.push('/connect/messaging/connection-requests')}
        >
          <UserCheck size={16} color={Colors.onPrimary} strokeWidth={2.2} />
          <Text style={[styles.actionText, { color: Colors.onPrimary }]}>Respond</Text>
        </Pressable>
      );
    case 'none':
    default:
      return (
        <Pressable
          style={[styles.actionBtn, styles.actionPrimary]}
          accessibilityRole="button"
          onPress={() =>
            router.push(
              `/connect/networking/connect-request?id=${encodeURIComponent(profile.id)}&name=${encodeURIComponent(profile.displayName)}`,
            )
          }
        >
          <UserPlus size={16} color={Colors.onPrimary} strokeWidth={2.2} />
          <Text style={[styles.actionText, { color: Colors.onPrimary }]}>Connect</Text>
        </Pressable>
      );
  }
}

function ProfileCard({ profile }: { profile: NetworkProfile }) {
  return (
    <Pressable
      style={styles.card}
      accessibilityRole="button"
      onPress={() => router.push(`/connect/networking/profile?id=${encodeURIComponent(profile.id)}`)}
    >
      <View style={styles.cardTop}>
        {profile.photos[0] ? (
          <Image source={{ uri: profile.photos[0] }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Users size={22} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
          </View>
        )}
        <View style={styles.cardHead}>
          <Text style={styles.name} numberOfLines={1}>{profile.displayName}</Text>
          <Text style={styles.headline} numberOfLines={1}>{profile.headline}</Text>
          {profile.company ? <Text style={styles.company} numberOfLines={1}>{profile.company}</Text> : null}
        </View>
      </View>

      <View style={styles.badges}>
        <DiscoveryVerifiedBadges flags={profile.verified} size="sm" />
      </View>

      {profile.openTo.length ? (
        <View style={styles.chips}>
          <DiscoveryChipRow items={profile.openTo} variant="static" />
        </View>
      ) : null}

      <View style={styles.cardFooter}>
        <Text style={styles.mutual}>
          {profile.mutualConnections} mutual{profile.mutualConnections === 1 ? '' : 's'}
        </Text>
        <ConnectAction profile={profile} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md },
  entryRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.lg,
  },
  entryCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  entryIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  entryLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.cardPadding,
    gap: Spacing.sm,
  },
  cardTop: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  avatar: { width: 56, height: 56, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  cardHead: { flex: 1, gap: 2 },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  headline: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  company: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  badges: { marginTop: 2 },
  chips: { marginTop: 2 },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  mutual: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 9,
    borderRadius: Radius.full,
  },
  actionPrimary: { backgroundColor: ConnectColors.brand },
  actionMuted: { backgroundColor: Colors.surfaceContainerHigh },
  actionConnected: { backgroundColor: Colors.iconBgTeal },
  actionText: { ...Typography.labelMd, fontWeight: '700' },
});
