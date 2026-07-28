// @ts-nocheck
/**
 * Vote Selection Modal — choose a vote package to purchase.
 * Stitch screen: "Vote Selection Modal"
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

export default function VoteModalScreen() {
  const { contestantId, contestantName, contestId } = useLocalSearchParams<{
    contestantId: string;
    contestantName: string;
    contestId: string;
  }>();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const packages = useQuery({
    queryKey: ['vote-packages', contestId],
    queryFn: () => fetchVotePackages(contestId),
    enabled: !!contestId,
  });

  const pkgs = packages.data ?? [];
  const selectedPkg = pkgs.find((p) => p.id === selectedId) ?? null;

  // Auto-select the popular/recommended package once loaded
  if (pkgs.length > 0 && selectedId === null) {
    const popular = pkgs.find((p) => p.popular) ?? pkgs[0];
    setSelectedId(popular.id);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base }}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: votingSpacing.md, padding: votingSpacing.margin, borderBottomWidth: 1, borderBottomColor: GLASS_BORDER }}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={votingColors.onSurface} />
        </Pressable>
        <Text style={[votingTypography.headlineSm, { color: votingColors.onSurface, flex: 1 }]}>Buy Votes</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: votingSpacing.margin, gap: votingSpacing.lg }}>
        {/* Who you're voting for */}
        <GlassCard>
          <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>Voting for</Text>
          <Text style={[votingTypography.headlineMd, { color: votingColors.onSurface }]}>{contestantName}</Text>
        </GlassCard>

        {/* Loading */}
        {packages.isLoading && (
          <View style={{ alignItems: 'center', paddingVertical: votingSpacing.xxl }}>
            <ActivityIndicator color={votingColors.gold.DEFAULT} size="large" />
          </View>
        )}

        {/* Error */}
        {packages.isError && !packages.isLoading && (
          <Pressable onPress={() => packages.refetch()} style={{ alignItems: 'center', paddingVertical: votingSpacing.lg }}>
            <Text style={[votingTypography.bodyMd, { color: votingColors.error, marginBottom: votingSpacing.sm }]}>Failed to load vote packages</Text>
            <Text style={[votingTypography.labelMd, { color: votingColors.gold.DEFAULT }]}>Retry</Text>
          </Pressable>
        )}

        {/* Package tiles */}
        {pkgs.length > 0 && (
          <View style={{ gap: votingSpacing.sm }}>
            <Text style={[votingTypography.labelMd, { color: votingColors.onSurfaceMuted }]}>Select a package</Text>
            {pkgs.map((pkg) => {
              const active = selectedId === pkg.id;
              const totalVotes = (pkg.votes ?? 0) + (pkg.bonusVotes ?? 0);
              return (
                <Pressable
                  key={pkg.id}
                  onPress={() => setSelectedId(pkg.id)}
                  style={({ pressed }) => ({
                    borderRadius: votingRadius.xl,
                    borderWidth: active ? 2 : 1,
                    borderColor: active ? votingColors.gold.DEFAULT : GLASS_BORDER,
                    backgroundColor: active ? 'rgba(242,202,80,0.08)' : votingColors.bg.card,
                    padding: votingSpacing.md,
                    opacity: pressed ? 0.88 : 1,
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
                      {(pkg.bonusVotes ?? 0) > 0 && (
                        <Text style={[votingTypography.labelSm, { color: votingColors.emerald.DEFAULT }]}>
                          +{pkg.bonusVotes} bonus votes included
                        </Text>
                      )}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={[votingTypography.headlineSm, { color: active ? votingColors.gold.DEFAULT : votingColors.onSurface }]}>
                        ₦{((pkg.priceKobo ?? 0) / 100).toLocaleString()}
                      </Text>
                      {pkg.votes > 0 && (
                        <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>
                          ₦{((pkg.priceKobo ?? 0) / pkg.votes / 100).toFixed(2)}/vote
                        </Text>
                      )}
                      {active && <Ionicons name="checkmark-circle" size={20} color={votingColors.gold.DEFAULT} />}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Cost summary */}
        {selectedPkg && (
          <GlassCard glow>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[votingTypography.bodyMd, { color: votingColors.onSurfaceMuted }]}>
                {((selectedPkg.votes ?? 0) + (selectedPkg.bonusVotes ?? 0)).toLocaleString()} votes total
              </Text>
              <Text style={[votingTypography.headlineSm, { color: votingColors.gold.DEFAULT }]}>
                ₦{((selectedPkg.priceKobo ?? 0) / 100).toLocaleString()}
              </Text>
            </View>
          </GlassCard>
        )}

        {/* CTAs */}
        <View style={{ gap: votingSpacing.sm }}>
          <VoteButton
            title={selectedPkg
              ? `Pay ₦${((selectedPkg.priceKobo ?? 0) / 100).toLocaleString()} & Vote`
              : packages.isLoading ? 'Loading packages...' : 'Select a package'}
            size="lg"
            disabled={!selectedPkg || packages.isLoading}
            onPress={() =>
              selectedPkg &&
              router.push({
                pathname: '/contest/payment-method',
                params: {
                  contestantId,
                  contestantName,
                  contestId,
                  packageId: selectedPkg.id,
                  voteCount: ((selectedPkg.votes ?? 0) + (selectedPkg.bonusVotes ?? 0)).toString(),
                  totalKobo: (selectedPkg.priceKobo ?? 0).toString(),
                },
              })
            }
          />
          <VoteButton
            title="Use Wallet Balance"
            variant="outline"
            disabled={!selectedPkg}
            onPress={() =>
              selectedPkg &&
              router.push({
                pathname: '/contest/payment-method',
                params: {
                  contestantId,
                  contestantName,
                  contestId,
                  packageId: selectedPkg.id,
                  voteCount: ((selectedPkg.votes ?? 0) + (selectedPkg.bonusVotes ?? 0)).toString(),
                  totalKobo: (selectedPkg.priceKobo ?? 0).toString(),
                  method: 'wallet',
                },
              })
            }
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
