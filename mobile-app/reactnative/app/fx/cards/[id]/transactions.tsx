import React from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import CardTransactionRow from '@/features/fx/components/CardTransactionRow';
import { useCard, useCardTransactions } from '@/features/fx/hooks/useFxCards';

export default function CardTransactionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: card } = useCard(id);
  const { data, isLoading, isError, refetch } = useCardTransactions(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Card activity" subtitle={card ? `${card.label} · •••• ${card.last4}` : undefined} />

      {isLoading ? (
        <StateView kind="loading" message="Loading activity…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load activity" actionLabel="Retry" onAction={() => refetch()} />
      ) : (data ?? []).length === 0 ? (
        <StateView kind="empty" icon="Receipt" title="No card activity yet" message="Purchases on this card will show up here." />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <View>
              <CardTransactionRow tx={item} />
              {index < (data?.length ?? 0) - 1 ? <View style={styles.divider} /> : null}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
});
