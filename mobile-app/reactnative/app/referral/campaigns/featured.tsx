import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { DisclosureCard } from '@/features/referral/components';
import { useFeaturedCampaigns } from '@/features/referral/campaigns/hooks';
import { CampaignCard } from '../(tabs)/campaigns';

// M-CMP-03 — Featured / seasonal campaigns (property, sport, festive).
export default function FeaturedCampaignsScreen() {
  const { data, isLoading, isError, refetch } = useFeaturedCampaigns();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Featured & seasonal" />
      {isLoading ? (
        <StateView kind="loading" message="Loading featured…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <DisclosureCard
            tone="info"
            title="Spotlighted right now"
            body="Seasonal pushes across property, sport and festive moments. All rewards still tie to your friends' verified activity."
          />
          {data && data.length > 0 ? (
            data.map((c) => <CampaignCard key={c.id} campaign={c} />)
          ) : (
            <StateView kind="empty" icon="Sparkles" title="Nothing featured" message="Check back during seasonal pushes." compact />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
});
