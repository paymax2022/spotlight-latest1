// @ts-nocheck
/**
 * Vote Success Celebration screen.
 * Stitch screen: "Vote Success Celebration"
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Share, StatusBar, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { GlassCard } from '@/components/voting/GlassCard';
import { VoteButton } from '@/components/voting/VoteButton';
import { GOLD_GLOW_SHADOW, votingColors, votingRadius, votingSpacing, votingTypography } from '@/theme/voting';

export default function VoteSuccessScreen() {
  const { contestantName, voteCount, freeVotesRemaining, newTotal } = useLocalSearchParams<{
    contestantName: string;
    voteCount: string;
    freeVotesRemaining: string;
    newTotal: string;
  }>();
  const router = useRouter();

  const handleShare = async () => {
    try {
      await Share.share({
        message: `I just voted for ${contestantName} on Spotlight! 🌟 Join me and cast your vote now!`,
        title: `I voted for ${contestantName}!`,
      });
    } catch {}
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base }}>
      <StatusBar barStyle="light-content" />

      <View style={{ flex: 1, padding: votingSpacing.margin, alignItems: 'center', justifyContent: 'center', gap: votingSpacing.xl }}>
        {/* Celebration icon with glow */}
        <View
          style={{
            width: 120, height: 120, borderRadius: 60,
            backgroundColor: 'rgba(242,202,80,0.15)',
            alignItems: 'center', justifyContent: 'center',
            ...GOLD_GLOW_SHADOW,
          }}
        >
          <LinearGradient
            colors={[votingColors.gold.container, votingColors.gold.DEFAULT]}
            style={{ width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 40 }}>🌟</Text>
          </LinearGradient>
        </View>

        {/* Headline */}
        <View style={{ alignItems: 'center', gap: votingSpacing.sm }}>
          <Text style={[votingTypography.headlineLgMobile, { color: votingColors.onSurface, textAlign: 'center' }]}>
            Vote Cast!
          </Text>
          <Text style={[votingTypography.bodyLg, { color: votingColors.onSurfaceMuted, textAlign: 'center' }]}>
            You voted for{'\n'}
            <Text style={{ color: votingColors.gold.DEFAULT, fontWeight: '700' }}>{contestantName}</Text>
          </Text>
        </View>

        {/* Stats */}
        <GlassCard glow style={{ width: '100%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
            {[
              { label: 'Votes Added', value: voteCount ?? '1' },
              { label: 'New Total', value: parseInt(newTotal ?? '0').toLocaleString() },
              { label: 'Free Votes Left', value: freeVotesRemaining ?? '0' },
            ].map((stat) => (
              <View key={stat.label} style={{ alignItems: 'center', gap: 4 }}>
                <Text style={[votingTypography.headlineMd, { color: votingColors.gold.DEFAULT }]}>{stat.value}</Text>
                <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted, textAlign: 'center' }]}>
                  {stat.label}
                </Text>
              </View>
            ))}
          </View>
        </GlassCard>

        {/* CTAs */}
        <View style={{ width: '100%', gap: votingSpacing.sm }}>
          <VoteButton
            title="Share Your Vote 📢"
            variant="outline"
            size="lg"
            onPress={handleShare}
          />
          <VoteButton
            title="Back to Leaderboard"
            size="lg"
            onPress={() => router.dismissAll()}
          />
        </View>

        {/* Keep voting nudge */}
        {parseInt(freeVotesRemaining ?? '0') > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="star" size={14} color={votingColors.gold.DEFAULT} />
            <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>
              You have {freeVotesRemaining} free vote{parseInt(freeVotesRemaining ?? '0') !== 1 ? 's' : ''} remaining today
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
