import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Tag, ClipboardList } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useMarket } from '@/features/fractionalre/hooks';
import MarketListingRow from '@/features/fractionalre/components/MarketListingRow';
import RiskRibbon from '@/features/fractionalre/components/RiskRibbon';

export default function SecondaryMarket() {
  const market = useMarket();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Secondary market"
        rightSlot={
          <Pressable hitSlop={10} onPress={() => router.push('/fractionalre/market/orders')}>
            <ClipboardList size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />
      {market.isLoading ? (
        <StateView kind="loading" message="Loading listings…" />
      ) : (market.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No active listings" message="Investors' fractions for resale will appear here." icon="Tag" />
      ) : (
        <FlatList
          data={market.data}
          keyExtractor={(l) => l.id}
          ListHeaderComponent={
            <View style={styles.header}>
              <RiskRibbon compact />
              <Pressable style={styles.listBtn} onPress={() => router.push('/fractionalre/market/list')}>
                <Tag size={16} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.listBtnText}>List my fraction</Text>
              </Pressable>
            </View>
          }
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <MarketListingRow listing={item} onPress={() => router.push(`/fractionalre/market/buy/${item.id}` as never)} />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { gap: Spacing.md, marginBottom: Spacing.md },
  listBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  listBtnText: { ...Typography.labelLg, color: Colors.primary },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
});
