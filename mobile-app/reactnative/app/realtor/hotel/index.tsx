import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Star, MapPin, ConciergeBell } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SearchBar from '@/components/SearchBar';
import StateView from '@/components/StateView';
import { useHotelSearch } from '@/features/realtor/hooks/useRealtorHotel';
import { formatNairaCompact } from '@/features/realtor/utils/realtorFormatters';

export default function HotelSearchScreen() {
  const [query, setQuery] = useState('');
  const hotels = useHotelSearch(query);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Hotels"
        subtitle="Rooms by the night"
        rightSlot={
          <Pressable onPress={() => router.push('/realtor/hotel/desk')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Front desk">
            <ConciergeBell size={22} color={Colors.onSurface} strokeWidth={2} />
          </Pressable>
        }
      />
      <SearchBar value={query} onChangeText={setQuery} placeholder="Search hotels by name or city" />

      {hotels.isLoading ? (
        <StateView kind="loading" message="Finding hotels…" />
      ) : (hotels.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="BedDouble" title="No hotels found" message="Try a different city or name." />
      ) : (
        <FlatList
          data={hotels.data}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => router.push(`/realtor/hotel/${item.id}`)}>
              <Image source={{ uri: item.coverUrl }} style={styles.cover} />
              <View style={styles.scoreChip}><Text style={styles.scoreText}>{item.reviewScore.toFixed(1)}</Text></View>
              <View style={styles.body}>
                <View style={styles.starsRow}>
                  {Array.from({ length: item.starRating }).map((_, i) => (
                    <Star key={i} size={13} color={Colors.gold} fill={Colors.gold} strokeWidth={0} />
                  ))}
                </View>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                <View style={styles.locRow}>
                  <MapPin size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={styles.loc}>{item.area}, {item.city}</Text>
                </View>
                <Text style={styles.price}>From {formatNairaCompact(item.fromNightly)}<Text style={styles.per}> /night</Text></Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, overflow: 'hidden', ...shadow1 },
  cover: { width: '100%', height: 160, backgroundColor: Colors.surfaceContainerHigh },
  scoreChip: { position: 'absolute', top: Spacing.sm, right: Spacing.sm, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  scoreText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
  body: { padding: Spacing.md, gap: 4 },
  starsRow: { flexDirection: 'row', gap: 2 },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  loc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  price: { ...Typography.titleMd, color: Colors.onSurface, marginTop: 2 },
  per: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
