import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, FlatList, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { UserPlus, Search, Star } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import BeneficiaryRow from '@/features/fx/components/BeneficiaryRow';
import { useBeneficiaries, useToggleFavoriteBeneficiary } from '@/features/fx/hooks/useFx';

export default function BeneficiariesHubScreen() {
  const { data, isLoading, isError, refetch } = useBeneficiaries();
  const toggleFav = useToggleFavoriteBeneficiary();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const list = data ?? [];
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((b) => b.name.toLowerCase().includes(q) || (b.bankName ?? '').toLowerCase().includes(q) || b.accountNumber.includes(q));
  }, [data, query]);

  const favorites = filtered.filter((b) => b.favorite);
  const others = filtered.filter((b) => !b.favorite);

  const open = (id: string) => router.push(`/fx/beneficiaries/${id}`);
  const addNew = () => router.push({ pathname: '/fx/send/new-beneficiary', params: { returnTo: 'hub' } });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Beneficiaries"
        rightSlot={
          <Pressable onPress={addNew} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add beneficiary">
            <UserPlus size={22} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        }
      />

      {(data ?? []).length > 0 ? (
        <View style={styles.searchWrap}>
          <Search size={16} color={Colors.outline} strokeWidth={2} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search beneficiaries…"
            placeholderTextColor={Colors.outline}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            accessibilityLabel="Search beneficiaries"
          />
        </View>
      ) : null}

      {isLoading ? (
        <StateView kind="loading" message="Loading beneficiaries…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load beneficiaries" actionLabel="Retry" onAction={() => refetch()} />
      ) : (data ?? []).length === 0 ? (
        <StateView
          kind="empty" icon="Users" title="No beneficiaries yet"
          message="Save recipients once to send to them faster next time."
          actionLabel="Add beneficiary" onAction={addNew}
        />
      ) : (
        <FlatList
          data={others}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            favorites.length > 0 ? (
              <View>
                <View style={styles.sectionRow}>
                  <Star size={13} color={Colors.gold} fill={Colors.gold} strokeWidth={2} />
                  <Text style={styles.sectionLabel}>Favorites</Text>
                </View>
                {favorites.map((b) => (
                  <BeneficiaryRow
                    key={b.id} beneficiary={b} showChevron
                    onPress={() => open(b.id)}
                    onToggleFavorite={() => toggleFav.mutate({ id: b.id, favorite: !b.favorite })}
                  />
                ))}
                {others.length > 0 ? <Text style={[styles.sectionLabel, styles.allLabel]}>All beneficiaries</Text> : null}
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <BeneficiaryRow
              beneficiary={item} showChevron
              onPress={() => open(item.id)}
              onToggleFavorite={() => toggleFav.mutate({ id: item.id, favorite: !item.favorite })}
            />
          )}
          ListEmptyComponent={query ? <Text style={styles.noResults}>No beneficiaries match "{query}"</Text> : null}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.xs,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md, height: 48,
  },
  searchInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface, padding: 0 },
  list: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  allLabel: { marginTop: Spacing.md },
  noResults: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.xl },
});
