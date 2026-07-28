// @ts-nocheck
// Estate discovery — search and select an estate to join
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listEstates } from '@/api/estate.api';
import { colors } from '@/theme';

export default function EstateSearchScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const estates = useQuery({
    queryKey: ['estates-search', query],
    queryFn: () => listEstates(query),
    enabled: true,
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Find Your Estate</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.content}>
        {/* Search bar */}
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={18} color={colors.neutral.placeholder} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by estate name or address..."
            placeholderTextColor={colors.neutral.placeholder}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => setQuery(search.trim())}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => { setSearch(''); setQuery(''); }}>
              <Ionicons name="close-circle" size={18} color={colors.neutral.placeholder} />
            </Pressable>
          )}
        </View>

        {/* Join options */}
        <View style={styles.altRow}>
          <Pressable style={styles.altCard} onPress={() => router.push('/estate/join/invite' as never)}>
            <Ionicons name="key-outline" size={24} color={colors.primary.DEFAULT} />
            <Text style={styles.altLabel}>Enter Invite Code</Text>
          </Pressable>
          <Pressable style={styles.altCard} onPress={() => router.push('/estate/join/qr' as never)}>
            <Ionicons name="qr-code-outline" size={24} color={colors.secondary.DEFAULT} />
            <Text style={styles.altLabel}>Scan QR Code</Text>
          </Pressable>
        </View>

        <Text style={styles.resultsLabel}>
          {query ? `Results for "${query}"` : 'All Estates'}
        </Text>

        {estates.isLoading ? (
          <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={estates.data ?? []}
            keyExtractor={(e) => e.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingBottom: 40 }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="home-outline" size={48} color={colors.neutral.placeholder} />
                <Text style={styles.emptyText}>No estates found</Text>
                {query ? (
                  <Pressable onPress={() => setQuery('')}>
                    <Text style={styles.emptyLink}>Clear search</Text>
                  </Pressable>
                ) : null}
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.estateCard, pressed && { opacity: 0.8 }]}
                onPress={() =>
                  router.push({ pathname: '/estate/join/request', params: { estateId: item.id, estateName: item.name } } as never)
                }
              >
                <View style={styles.estateIcon}>
                  <Ionicons name="home" size={22} color={colors.primary.DEFAULT} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.estateName}>{item.name}</Text>
                  {item.address ? (
                    <Text style={styles.estateAddress} numberOfLines={1}>{item.address}</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.neutral.placeholder} />
              </Pressable>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { flex: 1, padding: 16 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.neutral.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: colors.neutral.border, marginBottom: 14,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.neutral.text },
  altRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  altCard: {
    flex: 1, backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 16,
    alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.neutral.border,
  },
  altLabel: { fontSize: 13, fontWeight: '600', color: colors.neutral.text, textAlign: 'center' },
  resultsLabel: { fontSize: 13, fontWeight: '700', color: colors.neutral.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
  estateCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  estateIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primary.DEFAULT + '15', alignItems: 'center', justifyContent: 'center' },
  estateName: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  estateAddress: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 15, color: colors.neutral.textMuted },
  emptyLink: { fontSize: 14, color: colors.secondary.DEFAULT, fontWeight: '600' },
});
