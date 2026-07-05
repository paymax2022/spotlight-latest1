import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Megaphone, GraduationCap } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import CreatorDisclaimer from '@/features/spotlightwealth/components/CreatorDisclaimer';
import { useCampaign } from '@/features/spotlightwealth/hooks/useSpotlight';

export default function CampaignDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const campaign = useCampaign(id);
  const data = campaign.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Campaign" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {campaign.isLoading ? (
          <StateView kind="loading" message="Loading campaign…" />
        ) : campaign.isError || !data ? (
          <StateView kind="error" title="Couldn't load campaign" message="This campaign may no longer be available." actionLabel="Retry" onAction={() => campaign.refetch()} />
        ) : (
          <>
            <View style={[styles.card, shadow1]}>
              <View style={[styles.iconTile, { backgroundColor: data.iconColor }]}>
                <Megaphone size={24} color={Colors.onPrimary} strokeWidth={2} />
              </View>
              <Text style={styles.title}>{data.title}</Text>
              <Text style={styles.desc}>{data.description}</Text>
            </View>

            {/* Education-first reassurance */}
            <View style={styles.eduNote}>
              <View style={styles.eduIcon}><GraduationCap size={16} color={Colors.teal} strokeWidth={2} /></View>
              <Text style={styles.eduText}>This campaign is about financial education — no purchase or investment is required to take part.</Text>
            </View>

            <View style={styles.disclaimer}>
              <CreatorDisclaimer />
            </View>

            <View style={styles.cta}>
              <PrimaryButton label={data.cta} onPress={() => undefined} />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl, paddingTop: Spacing.sm },
  card: {
    marginHorizontal: Spacing.containerMargin,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
    padding: Spacing.cardPadding,
    gap: Spacing.sm,
  },
  iconTile: { width: 52, height: 52, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  title: { ...Typography.headlineMd, color: Colors.onSurface },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  eduNote: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
    backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md,
  },
  eduIcon: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center' },
  eduText: { ...Typography.labelMd, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  disclaimer: { marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md },
  cta: { marginHorizontal: Spacing.containerMargin, marginTop: Spacing.lg },
});
