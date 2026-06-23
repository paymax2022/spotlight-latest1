// @ts-nocheck
/**
 * Buy Votes Packages — shows available vote bundle packages.
 * Stitch screen: "Buy Votes Packages"
 */
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StatusBar, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';

import { fetchVotePackages } from '@/api/voting.api';
import { GlassCard } from '@/components/voting/GlassCard';
import { VoteButton } from '@/components/voting/VoteButton';
import { GLASS_BORDER, votingColors, votingRadius, votingSpacing, votingTypography } from '@/theme/voting';

export default function BuyVotesScreen() {
  const { contestId } = useLocalSearchParams<{ contestId?: string }>();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);

  const packages = useQuery({
    queryKey: ['vote-packages', contestId],
    queryFn: () => fetchVotePackages(contestId!),
    enabled: !!contestId,
  });

  const pkgs = packages.data ?? [];

  // Auto-select popular package once loaded
  if (pkgs.length > 0 && selected === null) {
    const popular = pkgs.find((p) => p.popular) ?? pkgs[0];
    setSelected(popular.id);
  }

  const selectedPkg = pkgs.find((p) => p.id === selected);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base }}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: votingSpacing.md, padding: votingSpacing.margin, borderBottomWidth: 1, borderBottomColor: GLASS_BORDER }}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={votingColors.onSurface} />
        </Pressable>
        <Text style={[votingTypography.headlineSm, { color: votingColors.onSurface, flex: 1 }]}>Buy Vote Packages</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: votingSpacing.margin, gap: votingSpacing.md }}>
        <Text style={[votingTypography.bodyMd, { color: votingColors.onSurfaceMuted }]}>
          Choose a package. Bonus votes are credited instantly.
        </Text>

        {packages.isLoading && (
          <View style={{ alignItems: 'center', paddingVertical: votingSpacing.xxl }}>
            <ActivityIndicator color={votingColors.gold.DEFAULT} size="large" />
          </View>
        )}

        {packages.isError && !packages.isLoading && (
          <Pressable onPress={() => packages.refetch()} style={{ alignItems: 'center', paddingVertical: votingSpacing.lg }}>
            <Text style={[votingTypography.bodyMd, { color: votingColors.error, marginBottom: votingSpacing.sm }]}>Failed to load packages</Text>
            <Text style={[votingTypography.labelMd, { color: votingColors.gold.DEFAULT }]}>Retry</Text>
          </Pressable>
        )}

        {pkgs.map((pkg) => {
          const active = selected === pkg.id;
          const totalVotes = pkg.votes + pkg.bonusVotes;
          return (
            <Pressable
              key={pkg.id}
              onPress={() => setSelected(pkg.id)}
              style={({ pressed }) => ({
                borderRadius: votingRadius.xl,
                borderWidth: active ? 2 : 1,
                borderColor: active ? votingColors.gold.DEFAULT : GLASS_BORDER,
                backgroundColor: active ? 'rgba(242,202,80,0.08)' : votingColors.bg.card,
                padding: votingSpacing.md,
                opacity: pressed ? 0.88 : 1,
                ...(pkg.popular ? {
                  shadowColor: votingColors.gold.DEFAULT,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.2, shadowRadius: 12, elevation: 6,
                } : {}),
              })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ gap: 4 }}>
                  {pkg.label && (
                    <View style={{ backgroundColor: votingColors.indigo.container, borderRadius: votingRadius.full, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
                      <Text style={[votingTypography.labelSm, { color: votingColors.onSurface }]}>{pkg.label}</Text>
                    </View>
                  )}
                  <Text style={[votingTypography.headlineMd, { color: active ? votingColors.gold.DEFAULT : votingColors.onSurface }]}>
                    {totalVotes.toLocaleString()} votes
                  </Text>
                  {pkg.bonusVotes > 0 && (
                    <Text style={[votingTypography.labelSm, { color: votingColors.emerald.DEFAULT }]}>
                      +{pkg.bonusVotes} bonus votes included
                    </Text>
                  )}
                </View>

                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={[votingTypography.headlineSm, { color: active ? votingColors.gold.DEFAULT : votingColors.onSurface }]}>
                    ₦{(pkg.priceKobo / 100).toLocaleString()}
                  </Text>
                  <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>
                    ₦{(pkg.priceKobo / pkg.votes / 100).toFixed(2)}/vote
                  </Text>
                  {active && <Ionicons name="checkmark-circle" size={20} color={votingColors.gold.DEFAULT} />}
                </View>
              </View>
            </Pressable>
          );
        })}

        {selectedPkg && (
          <View style={{ marginTop: votingSpacing.sm, gap: votingSpacing.sm }}>
            <VoteButton
              title={`Buy ${(selectedPkg.votes + selectedPkg.bonusVotes).toLocaleString()} votes — ₦${(selectedPkg.priceKobo / 100).toLocaleString()}`}
              size="lg"
              onPress={() =>
                router.push({
                  pathname: '/contest/payment-method',
                  params: {
                    contestId,
                    packageId: selectedPkg.id,
                    voteCount: (selectedPkg.votes + selectedPkg.bonusVotes).toString(),
                    totalKobo: selectedPkg.priceKobo.toString(),
                  },
                })
              }
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
