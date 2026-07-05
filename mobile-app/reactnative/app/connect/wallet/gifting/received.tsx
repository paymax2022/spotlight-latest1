import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import MoneyAmount from '@/features/connect/components/wallet-MoneyAmount';
import SolicitationGuard from '@/features/connect/components/wallet-SolicitationGuard';
import type { GiftTransaction } from '@/features/connect/wallet/types';
import { useReceivedGifts } from '@/features/connect/wallet/hooks';

// WL-09 — Received gifts history (real Naira credited to the wallet).
export default function ReceivedGifts() {
  const { data, isLoading, error, refetch } = useReceivedGifts();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Received gifts" rightSlot={
        <Pressable onPress={() => router.push('/connect/wallet/gifting/sent')} hitSlop={8}>
          <Text style={styles.tab}>Sent</Text>
        </Pressable>
      } />
      {isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : error ? (
        <StateView kind="error" title="Couldn't load gifts" actionLabel="Retry" onAction={() => refetch()} />
      ) : (data ?? []).length === 0 ? (
        <StateView kind="empty" icon="Gift" title="No gifts received yet"
          message="Gifts others send you appear here." />
      ) : (
        <FlatList<GiftTransaction>
          data={data}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<View style={styles.header}><SolicitationGuard /></View>}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => router.push({ pathname: '/connect/wallet/gifting/gift-detail', params: { id: item.id } })}
            >
              <Text style={styles.emoji}>{item.product.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.product.name} from {item.sender?.displayName ?? 'Someone'}</Text>
                <Text style={styles.sub}>{new Date(item.createdAt).toLocaleDateString('en-NG')} · {item.status}</Text>
              </View>
              <MoneyAmount kobo={item.amountKobo} direction="credit" size="sm" />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  tab: { ...Typography.labelMd, color: Colors.primary },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40 },
  header: { marginBottom: Spacing.md },
  sep: { height: 1, backgroundColor: Colors.surfaceContainerLow },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  pressed: { opacity: 0.6 },
  emoji: { fontSize: 28, width: 40, textAlign: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
