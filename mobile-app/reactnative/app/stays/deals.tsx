import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Smartphone, Clock, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { PropertyCard } from '@/features/stays/components';
import { useDeals, useToggleSaved } from '@/features/stays/hooks';
import { isSavedSync } from '@/features/stays/api';
import { StaysColors } from '@/features/stays/constants/stays.constants';
import type { Deal } from '@/features/stays/types';

const KIND_ICON = { mobile_rate: Smartphone, last_minute: Clock, loyalty: Star } as const;

export default function DealsScreen() {
  const deals = useDeals();
  const toggleSave = useToggleSaved();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Deals & offers" subtitle="Mobile rates, last-minute & loyalty" />
      {deals.isLoading ? (
        <StateView kind="loading" message="Loading deals…" />
      ) : deals.isError ? (
        <StateView kind="error" title="Couldn't load deals" actionLabel="Retry" onAction={() => deals.refetch()} />
      ) : (deals.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="Tag" title="No deals right now" message="Check back soon for fresh offers." />
      ) : (
        <FlatList
          data={deals.data}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.lg }} />}
          renderItem={({ item }: { item: Deal }) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <View>
                <View style={styles.head}>
                  <View style={styles.headIcon}><Icon size={16} color={StaysColors.accent} strokeWidth={2} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.headTitle}>{item.title}</Text>
                    <Text style={styles.headSub}>{item.subtitle}</Text>
                  </View>
                </View>
                <PropertyCard
                  property={item.property}
                  saved={isSavedSync(item.property.id)}
                  onToggleSave={() => toggleSave.mutate(item.property.id)}
                  onPress={() => router.push(`/stays/property/${item.property.id}`)}
                />
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, paddingTop: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  headIcon: { width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  headTitle: { ...Typography.titleMd, color: Colors.onSurface },
  headSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
