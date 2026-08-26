import React, { useState } from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Pressable, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import { useListing } from '@/features/realtor/hooks/useRealtor';

const W = Dimensions.get('window').width;

export default function GalleryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listing = useListing(String(id));
  const [active, setActive] = useState(0);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/realtor')} hitSlop={10} accessibilityLabel="Close gallery">
          <X size={24} color={Colors.white} strokeWidth={2} />
        </Pressable>
        {listing.data ? (
          <Text style={styles.counter}>{active + 1} / {listing.data.media.length}</Text>
        ) : null}
        <View style={{ width: 24 }} />
      </View>

      {listing.isLoading ? (
        <StateView kind="loading" />
      ) : !listing.data ? (
        <StateView kind="error" title="Photos unavailable" />
      ) : (
        <>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setActive(Math.round(e.nativeEvent.contentOffset.x / W))}
            style={styles.flex}
          >
            {listing.data.media.map((uri) => (
              <View key={uri} style={styles.page}>
                <Image source={{ uri }} style={styles.image} resizeMode="contain" />
              </View>
            ))}
          </ScrollView>
          <View style={styles.dots}>
            {listing.data.media.map((uri, i) => (
              <View key={uri} style={[styles.dot, i === active && styles.dotActive]} />
            ))}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.backdropDark },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.containerMargin,
    paddingVertical: Spacing.md,
  },
  counter: { ...Typography.labelMd, color: Colors.white },
  page: { width: W, alignItems: 'center', justifyContent: 'center' },
  image: { width: W, height: '100%' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: Spacing.lg },
  dot: { width: 6, height: 6, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { backgroundColor: Colors.white, width: 18 },
});
