// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, Text, View } from 'react-native';

import { getDashboard } from '@/api/dashboard.api';
import { TransactionCard } from '@/components/transactions/TransactionCard';
import { AppButton } from '@/components/ui/AppButton';
import { AppCard } from '@/components/ui/AppCard';
import { AppLoader } from '@/components/ui/AppLoader';
import { AppScreen } from '@/components/ui/AppScreen';
import { AppText } from '@/components/ui/AppText';
import { colors, spacing } from '@/theme';
import { GOLD_GLOW_SHADOW, votingColors } from '@/theme/voting';
import { formatCurrency } from '@/utils/format';

export default function HomeScreen() {
  const router = useRouter();
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard });

  if (dashboard.isLoading) return <AppLoader />;

  return (
    <AppScreen refreshControl={<RefreshControl refreshing={dashboard.isRefetching} onRefresh={dashboard.refetch} />}>
      <View>
        <AppText variant="caption" color={colors.neutral.textMuted}>Welcome back</AppText>
        <AppText variant="h1">{dashboard.data?.user?.fullName || 'Paymax user'}</AppText>
      </View>

      {dashboard.isError ? (
        <AppCard>
          <AppText>Unable to load dashboard.</AppText>
          <AppButton title="Retry" onPress={() => dashboard.refetch()} />
        </AppCard>
      ) : (
        <>
          <AppCard>
            <AppText color={colors.neutral.textMuted}>Wallet Balance</AppText>
            <AppText variant="h1">{formatCurrency(dashboard.data?.wallet?.balance, dashboard.data?.wallet?.currency)}</AppText>
            <AppButton title="Fund Wallet" variant="secondary" onPress={() => router.push('/wallet')} />
          </AppCard>

          {/* Voting Contest Banner */}
          <Pressable
            onPress={() => router.push('/(protected)/(tabs)/vote')}
            style={({ pressed }) => ({
              borderRadius: 16,
              overflow: 'hidden',
              backgroundColor: votingColors.bg.card,
              borderWidth: 1,
              borderColor: pressed ? votingColors.gold.DEFAULT : votingColors.outlineSubtle,
              padding: spacing[4],
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing[3],
              opacity: pressed ? 0.85 : 1,
              ...GOLD_GLOW_SHADOW,
            })}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 999,
                backgroundColor: votingColors.gold.container,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="trophy" size={26} color={votingColors.gold.on} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: votingColors.gold.DEFAULT, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 2 }}>
                Live Now
              </Text>
              <Text style={{ color: votingColors.onSurface, fontSize: 17, fontWeight: '700' }}>
                Voting Contests
              </Text>
              <Text style={{ color: votingColors.onSurfaceMuted, fontSize: 13, marginTop: 2 }}>
                Vote for your favourite contestant
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={votingColors.onSurfaceMuted} />
          </Pressable>

          <View style={{ gap: spacing[3] }}>
            <AppText variant="h2">Bills</AppText>
            <View style={{ gap: spacing[3] }}>
              <AppButton title="Buy Airtime" onPress={() => router.push('/airtime')} />
              <AppButton title="Buy Data" onPress={() => router.push('/data')} />
              <AppButton title="Pay Electricity" onPress={() => router.push('/electricity')} />
              <AppButton title="Cable TV" onPress={() => router.push('/cable')} />
            </View>
          </View>

          <View style={{ gap: spacing[3] }}>
            <AppText variant="h2">Recent Transactions</AppText>
            {dashboard.data?.recentTransactions?.length ? (
              dashboard.data.recentTransactions.map((item) => (
                <TransactionCard key={item.id} transaction={item} onPress={() => router.push(`/transactions/${item.id}`)} />
              ))
            ) : (
              <AppText color={colors.neutral.textMuted}>No recent transactions yet.</AppText>
            )}
          </View>
        </>
      )}
    </AppScreen>
  );
}
