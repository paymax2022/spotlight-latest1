import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Search, Plus, Star, MapPin, ChevronRight, Package } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import { useListings, formatNaira } from '@/features/social/escrow';
import { SocialColors } from '@/features/social/constants/social.constants';
import type { Listing } from '@/features/social/escrow';

export default function BrowseListings() {
  const [query, setQuery] = useState('');
  const listings = useListings(query);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <View style={styles.headerTitleWrap}><Text style={styles.eyebrow}>Marketplace</Text><Text style={styles.headerTitle}>Buy & sell with escrow</Text></View>
        <Pressable onPress={() => router.push('/social/listing/create')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Create listing"><Plus size={22} color={Colors.onSurface} /></Pressable>
      </View>

      <View style={styles.searchWrap}>
        <Search size={18} color={SocialColors.muted} />
        <TextInput style={styles.searchInput} placeholder="Search items…" placeholderTextColor={SocialColors.muted} value={query} onChangeText={setQuery} autoCapitalize="none" />
      </View>

      {listings.isLoading ? (
        <StateView kind="loading" message="Loading listings…" />
      ) : listings.isError ? (
        <StateView kind="error" title="Couldn't load listings" actionLabel="Retry" onAction={() => listings.refetch()} />
      ) : (listings.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" title="No listings found" message="Be the first to list an item." icon="Package" actionLabel="Create a listing" onAction={() => router.push('/social/listing/create')} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {listings.data!.map((l) => <ListingRow key={l.id} listing={l} onPress={() => router.push(`/social/listing/${l.id}`)} />)}
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ListingRow({ listing, onPress }: { listing: Listing; onPress: () => void }) {
  const sold = listing.status === 'sold';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <View style={[styles.thumb, { backgroundColor: listing.thumbColor }]}><Package size={22} color="#FFFFFF" /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{listing.title}</Text>
        <Text style={styles.price}>{formatNaira(listing.priceKobo)}</Text>
        <View style={styles.metaRow}>
          <Star size={12} color={SocialColors.warn} />
          <Text style={styles.meta}>{listing.sellerRating.toFixed(1)}</Text>
          <MapPin size={12} color={SocialColors.muted} />
          <Text style={styles.meta}>{listing.location}</Text>
          {sold ? <View style={styles.soldChip}><Text style={styles.soldText}>Sold</Text></View> : null}
        </View>
      </View>
      <ChevronRight size={18} color={SocialColors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.containerMargin, marginBottom: Spacing.sm, paddingHorizontal: Spacing.md, height: 48, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  searchInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface, paddingVertical: 0 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: SocialColors.surface, borderRadius: Radius.lg, padding: Spacing.md, ...shadow1 },
  thumb: { width: 56, height: 56, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleMd, color: SocialColors.text },
  price: { ...Typography.labelLg, color: SocialColors.brand, marginTop: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  meta: { ...Typography.labelSm, color: SocialColors.muted, marginRight: 4 },
  soldChip: { backgroundColor: SocialColors.surfaceAlt, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  soldText: { ...Typography.labelSm, color: SocialColors.muted },
});
