import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import AjoCircleCard from '@/features/savings/components/AjoCircleCard';
import DisclosureBanner from '@/features/savings/components/DisclosureBanner';
import { useDiscoverCircles } from '@/features/savings/hooks';
import { AJO_ROTATION_DISCLOSURE } from '@/features/savings/constants/savings.constants';

export default function AjoDiscover() {
  const circles = useDiscoverCircles();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Discover Ajo"
        rightSlot={
          <Pressable onPress={() => router.push('/savings/ajo/create')} hitSlop={10} accessibilityLabel="Create circle">
            <Plus size={22} color={Colors.onSurface} />
          </Pressable>
        }
      />
      {circles.isLoading ? (
        <StateView kind="loading" message="Finding circles…" />
      ) : circles.isError ? (
        <StateView kind="error" title="Couldn't load circles" actionLabel="Retry" onAction={() => circles.refetch()} />
      ) : (circles.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No open circles" message="Be the first — start your own Ajo circle." actionLabel="Create circle" onAction={() => router.push('/savings/ajo/create')} icon="Repeat" />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <DisclosureBanner text={AJO_ROTATION_DISCLOSURE} tone="warn" />
          {circles.data!.map((c) => (
            <AjoCircleCard key={c.id} circle={c} onPress={() => router.push(`/savings/ajo/${c.id}`)} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
});
