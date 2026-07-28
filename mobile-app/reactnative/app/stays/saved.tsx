import React from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { PropertyCard } from '@/features/stays/components';
import { useSaved, useToggleSaved } from '@/features/stays/hooks';

export default function SavedScreen() {
  const saved = useSaved();
  const toggleSave = useToggleSaved();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Saved" subtitle="Your wishlists" />
      {saved.isLoading ? (
        <StateView kind="loading" message="Loading saved stays…" />
      ) : saved.isError ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => saved.refetch()} />
      ) : (saved.data?.length ?? 0) === 0 ? (
        <StateView
          kind="empty"
          icon="Heart"
          title="No saved stays yet"
          message="Tap the heart on any property to save it here."
          actionLabel="Browse stays"
          onAction={() => router.replace('/stays')}
        />
      ) : (
        <FlatList
          data={saved.data}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item }) => (
            <PropertyCard
              property={item}
              saved
              onToggleSave={() => toggleSave.mutate(item.id)}
              onPress={() => router.push(`/stays/property/${item.id}`)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, paddingTop: Spacing.sm },
});
