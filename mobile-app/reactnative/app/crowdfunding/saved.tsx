import React from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import CampaignCard from '@/features/crowdfunding/components/CampaignCard';
import { useSavedCampaigns, useToggleSave } from '@/features/crowdfunding/hooks/useCrowdfunding';

export default function SavedScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useSavedCampaigns();
  const toggleSave = useToggleSave();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Saved campaigns" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load saved" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderItem={({ item }) => (
            <CampaignCard
              campaign={item}
              onPress={() => router.push(`/crowdfunding/campaign/${item.id}`)}
              onToggleSave={(next) => toggleSave.mutate({ id: item.id, saved: next })}
            />
          )}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="BookmarkX"
              title="No saved campaigns yet"
              message="Tap the heart on any campaign to save it here for later."
              actionLabel="Explore campaigns"
              onAction={() => router.replace('/crowdfunding')}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 100, flexGrow: 1 },
});
