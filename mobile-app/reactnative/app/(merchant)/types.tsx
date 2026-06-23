import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { MerchantTypeCard } from '@/features/merchant/components';
import { useMerchantTypes } from '@/features/merchant/hooks/useMerchant';

// Screen: Merchant-type picker within a module (FR-6).
export default function MerchantTypePickerScreen() {
  const { moduleId } = useLocalSearchParams<{ moduleId: string }>();
  const { data, isLoading, isError, refetch } = useMerchantTypes(moduleId);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Choose a provider type" subtitle="Each type has its own onboarding" />

      {isLoading && !data ? (
        <StateView kind="loading" message="Loading provider types" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load provider types" actionLabel="Retry" onAction={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <StateView kind="empty" icon="Store" title="No provider types" message="This module has no open provider types yet." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {data.map((type) => (
            <MerchantTypeCard
              key={type.id}
              type={type}
              onPress={() => router.push(`/(merchant)/apply/${type.id}`)}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },
});
