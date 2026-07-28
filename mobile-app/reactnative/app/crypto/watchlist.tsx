import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { BellPlus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import AssetRow from '@/features/crypto/components/AssetRow';
import { useWatchlist } from '@/features/crypto/hooks/useCrypto';

export default function CryptoWatchlistScreen() {
  const watchlist = useWatchlist();
  const list = watchlist.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Watchlist"
        subtitle="Assets you're tracking"
        rightSlot={
          <Pressable onPress={() => router.push('/crypto/alerts')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Price alerts">
            <BellPlus size={22} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        }
      />

      {watchlist.isLoading ? (
        <StateView kind="loading" message="Loading watchlist…" />
      ) : watchlist.isError ? (
        <StateView kind="error" title="Couldn't load watchlist" message="Please try again." actionLabel="Retry" onAction={() => watchlist.refetch()} />
      ) : list.length === 0 ? (
        <StateView
          kind="empty" icon="Star"
          title="Your watchlist is empty"
          message="Tap the star on any asset to track its price here — no trading required."
          actionLabel="Explore assets" onAction={() => router.push('/crypto/assets')}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            {list.map((a, i, arr) => (
              <View key={a.id}>
                <AssetRow asset={a} onPress={() => router.push(`/crypto/asset/${a.symbol}`)} />
                {i < arr.length - 1 ? <View style={styles.divider} /> : null}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingVertical: Spacing.md, paddingBottom: Spacing.xxl },
  card: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
});
