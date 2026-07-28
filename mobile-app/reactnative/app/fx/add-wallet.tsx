import React, { useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { useBalances, useAddWallet } from '@/features/fx/hooks/useFx';
import { CURRENCIES, WALLET_CURRENCIES } from '@/features/fx/constants/fx.constants';
import type { CurrencyCode } from '@/features/fx/types/fx.types';

export default function AddWalletScreen() {
  const balances = useBalances();
  const add = useAddWallet();
  const [selected, setSelected] = useState<CurrencyCode | null>(null);

  const existing = new Set((balances.data ?? []).map((b) => b.currency));
  const available = WALLET_CURRENCIES.filter((c) => !existing.has(c));

  const onAdd = async () => {
    if (!selected) return;
    await add.mutateAsync(selected);
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Add currency wallet</Text>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <X size={22} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>
      </View>
      <Text style={styles.sub}>Open a new wallet to hold and convert another currency.</Text>

      {available.length === 0 ? (
        <View style={styles.allAdded}>
          <View style={styles.allIcon}><Check size={26} color={Colors.teal} strokeWidth={2.5} /></View>
          <Text style={styles.allText}>You've added every available currency wallet.</Text>
        </View>
      ) : (
        <FlatList
          data={available}
          keyExtractor={(c) => c}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const meta = CURRENCIES[item];
            const sel = selected === item;
            return (
              <Pressable
                onPress={() => setSelected(item)}
                style={[styles.row, sel && styles.rowSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected: sel }}
              >
                <Text style={styles.flag}>{meta.flag}</Text>
                <View style={styles.flex}>
                  <Text style={styles.code}>{meta.code}</Text>
                  <Text style={styles.name}>{meta.name}</Text>
                </View>
                <View style={[styles.radio, sel && styles.radioOn]}>
                  {sel ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {available.length > 0 ? (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Add wallet" onPress={onAdd} loading={add.isPending} disabled={!selected} />
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.xs },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  rowSelected: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLow },
  flex: { flex: 1 },
  flag: { fontSize: 28 },
  code: { ...Typography.labelLg, color: Colors.onSurface },
  name: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  radio: { width: 24, height: 24, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  allAdded: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  allIcon: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  allText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
