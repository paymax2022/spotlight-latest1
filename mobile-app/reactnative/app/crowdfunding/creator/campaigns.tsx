import React, { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedTabs from '@/features/crowdfunding/components/SegmentedTabs';
import CreatorCampaignRow from '@/features/crowdfunding/components/CreatorCampaignRow';
import { useMyCampaigns, useCreatorStats } from '@/features/crowdfunding/hooks/useCreator';
import CreatorCampaignsBanner from '@/features/crowdfunding/components/CreatorCampaignsBanner';

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'DRAFT', label: 'Drafts' },
  { value: 'PENDING_REVIEW', label: 'In review' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FROZEN', label: 'Frozen' },
  { value: 'REJECTED', label: 'Rejected' },
];

const EMPTY: Record<string, { title: string; message: string }> = {
  all: { title: 'No campaigns yet', message: 'Start your first campaign to begin raising funds.' },
  ACTIVE: { title: 'No active campaigns', message: 'Approved, live campaigns will appear here.' },
  paused: { title: 'No paused campaigns', message: 'Campaigns you pause are hidden from discovery and listed here.' },
  DRAFT: { title: 'No drafts', message: 'Campaigns you save but don’t submit stay here.' },
  PENDING_REVIEW: { title: 'Nothing in review', message: 'Submitted campaigns awaiting admin approval show here.' },
  COMPLETED: { title: 'No completed campaigns', message: 'Finished campaigns will be listed here.' },
  FROZEN: { title: 'No frozen campaigns', message: 'Campaigns paused by Trust & Safety appear here.' },
  REJECTED: { title: 'No rejected campaigns', message: 'Campaigns that didn’t pass review appear here.' },
};

export default function MyCampaignsScreen() {
  const [tab, setTab] = useState('all');

  // "Paused" is NOT a status: it is a boolean that sits alongside whatever
  // review status the campaign has. So it cannot be pushed to the server as a
  // status filter — fetch unfiltered and select on the field. A paused ACTIVE
  // campaign therefore appears under both Active and Paused, which is honest:
  // it really is both, and its row carries both badges.
  const isPausedTab = tab === 'paused';
  const statusFilter = tab === 'all' || isPausedTab ? undefined : tab;

  const { data, isLoading, isError, refetch, isRefetching } = useMyCampaigns(statusFilter);
  const rows = isPausedTab ? (data ?? []).filter((c) => c.paused) : (data ?? []);
  const stats = useCreatorStats();
  const e = EMPTY[tab];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="My campaigns" />
      <View style={styles.bannerWrap}>
        <CreatorCampaignsBanner
          stats={stats.data}
          isLoading={stats.isLoading}
          onStart={() => router.push('/crowdfunding/create')}
        />
      </View>
      <View style={styles.tabs}>
        <SegmentedTabs options={TABS} value={tab} onChange={setTab} scrollable />
      </View>

      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load campaigns" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderItem={({ item }) => (
            <CreatorCampaignRow
              campaign={item}
              // A row is the way into managing that campaign — edit, pause,
              // feature, withdraw, delete — not just its analytics. A DRAFT has
              // never been submitted, so it goes back to the wizard preview.
              onPress={() =>
                item.status === 'DRAFT'
                  ? router.push('/crowdfunding/create/preview')
                  : router.push(`/crowdfunding/creator/campaign/${item.id}`)
              }
            />
          )}
          ListEmptyComponent={
            <StateView kind="empty" icon="Megaphone" title={e.title} message={e.message} actionLabel="Start a campaign" onAction={() => router.push('/crowdfunding/create')} />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  bannerWrap: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xs },
  tabs: { paddingBottom: Spacing.sm },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 100, flexGrow: 1 },
});
