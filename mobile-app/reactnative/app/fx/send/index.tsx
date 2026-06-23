import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, FlatList, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { UserPlus, Search, Star, Users, CalendarClock, ListPlus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import BeneficiaryRow from '@/features/fx/components/BeneficiaryRow';
import { useBeneficiaries, useToggleFavoriteBeneficiary } from '@/features/fx/hooks/useFx';

export default function SendSelectBeneficiaryScreen() {
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Send money"
        subtitle="Choose who to pay"
        rightSlot={
          <Pressable onPress={() => router.push('/fx/beneficiaries')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Manage beneficiaries">
            <Users size={22} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        }
      />

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

      <View style={styles.quickRow}>
        <Pressable style={styles.quickBtn} onPress={() => router.push('/fx/send/recurring')} accessibilityRole="button" accessibilityLabel="Schedule recurring payout">
          <CalendarClock size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.quickText}>Schedule</Text>
        </Pressable>
        <Pressable style={styles.quickBtn} onPress={() => router.push('/fx/send/bulk')} accessibilityRole="button" accessibilityLabel="Bulk payout">
          <ListPlus size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.quickText}>Bulk payout</Text>
        </Pressable>
      </View>

      <Pressable style={styles.addRow} onPress={() => router.push('/fx/send/new-beneficiary')} accessibilityRole="button">
        <View style={styles.addIcon}><UserPlus size={20} color={Colors.secondary} strokeWidth={2} /></View>
        <Text style={styles.addText}>Add new beneficiary</Text>
      </Pressable>

      {isLoading ? (
        <StateView kind="loading" message="Loading beneficiaries…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load beneficiaries" actionLabel="Retry" onAction={() => refetch()} />
      ) : (data ?? []).length === 0 ? (
        <StateView
          kind="empty" icon="Users" title="No beneficiaries yet"
          message="Add a recipient to send money across borders."
          actionLabel="Add beneficiary" onAction={() => router.push('/fx/send/new-beneficiary')}
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
                    onPress={() => router.push({ pathname: '/fx/send/amount', params: { beneficiaryId: b.id } })}
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
              onPress={() => router.push({ pathname: '/fx/send/amount', params: { beneficiaryId: item.id } })}
              onToggleFavorite={() => toggleFav.mutate({ id: item.id, favorite: !item.favorite })}
            />
          )}
          ListEmptyComponent={
            query ? <Text style={styles.noResults}>No beneficiaries match "{query}"</Text> : null
          }
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
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md, marginBottom: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  quickRow: { flexDirection: 'row', gap: Spacing.sm, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md },
  quickBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  quickText: { ...Typography.labelMd, color: Colors.secondary },
  addIcon: { width: 42, height: 42, borderRadius: Radius.full, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  addText: { ...Typography.labelLg, color: Colors.secondary },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: Spacing.sm },
  sectionLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  allLabel: { marginTop: Spacing.md },
  noResults: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.xl },
});
