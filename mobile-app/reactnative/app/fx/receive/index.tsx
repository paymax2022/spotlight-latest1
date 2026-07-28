import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, ChevronRight, Landmark, Globe, ArrowDownLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import CurrencyPickerSheet from '@/features/fx/components/CurrencyPickerSheet';
import { useVirtualAccounts, useCollections, useCreateVirtualAccount } from '@/features/fx/hooks/useFx';
import { CURRENCIES } from '@/features/fx/constants/fx.constants';
import { formatMoneyObj, relativeTime } from '@/features/fx/utils/fxFormatters';
import type { CurrencyCode, VirtualAccountType } from '@/features/fx/types/fx.types';

const RECEIVE_CURRENCIES: CurrencyCode[] = ['NGN', 'USD', 'EUR', 'GBP'];

export default function ReceiveScreen() {
  const accounts = useVirtualAccounts();
  const collections = useCollections();
  const create = useCreateVirtualAccount();
  const [picker, setPicker] = useState(false);

  const onCreate = async (currency: CurrencyCode) => {
    const type: VirtualAccountType = currency === 'NGN' ? 'virtual_account' : 'iban';
    const created = await create.mutateAsync({ currency, type });
    router.push(`/fx/receive/${created.id}`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Receive" subtitle="Collect money into your wallets" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Accounts */}
        <SectionHeader title="Your collection accounts" />
        {accounts.isLoading ? (
          <StateView kind="loading" compact />
        ) : (accounts.data ?? []).length === 0 ? (
          <StateView kind="empty" icon="Landmark" title="No accounts yet" message="Create a virtual account or IBAN to start receiving." compact />
        ) : (
          <View style={styles.list}>
            {(accounts.data ?? []).map((a) => {
              const meta = CURRENCIES[a.currency];
              const Icon = a.type === 'iban' ? Globe : Landmark;
              return (
                <Pressable key={a.id} style={[styles.acctCard, shadow1]} onPress={() => router.push(`/fx/receive/${a.id}`)} accessibilityRole="button">
                  <View style={styles.acctIcon}><Icon size={18} color={Colors.secondary} strokeWidth={2} /></View>
                  <View style={styles.flex}>
                    <Text style={styles.acctTitle}>{meta.flag} {a.currency} {a.type === 'iban' ? 'IBAN' : 'Virtual account'}</Text>
                    <Text style={styles.acctSub} numberOfLines={1}>
                      {a.type === 'iban' ? a.details.iban : `${a.details.bankName} · ${a.details.accountNumber}`}
                    </Text>
                  </View>
                  <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                </Pressable>
              );
            })}
          </View>
        )}

        <Pressable style={styles.addBtn} onPress={() => setPicker(true)} accessibilityRole="button">
          <Plus size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.addText}>Create account / IBAN</Text>
        </Pressable>

        {/* Collection history */}
        <View style={styles.section}>
          <SectionHeader title="Recent collections" actionLabel="See all" onAction={() => router.push('/fx/transactions?type=collection')} />
          {collections.isLoading ? (
            <StateView kind="loading" compact />
          ) : (collections.data ?? []).length === 0 ? (
            <StateView kind="empty" icon="ArrowDownLeft" title="No collections yet" message="Inbound payments will show up here." compact />
          ) : (
            <View style={styles.histCard}>
              {(collections.data ?? []).map((c, i, arr) => (
                <View key={c.id}>
                  <View style={styles.histRow}>
                    <View style={styles.histIcon}><ArrowDownLeft size={16} color={Colors.teal} strokeWidth={2} /></View>
                    <View style={styles.flex}>
                      <Text style={styles.histName} numberOfLines={1}>{c.senderName ?? 'Inbound payment'}</Text>
                      <Text style={styles.histSub} numberOfLines={1}>{relativeTime(c.createdAt)}{c.reference ? ` · ${c.reference}` : ''}</Text>
                    </View>
                    <Text style={styles.histAmount}>+{formatMoneyObj(c.amount)}</Text>
                  </View>
                  {i < arr.length - 1 ? <View style={styles.histDivider} /> : null}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <CurrencyPickerSheet
        visible={picker}
        title="Receive in"
        options={RECEIVE_CURRENCIES}
        onSelect={(c) => onCreate(c)}
        onClose={() => setPicker(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  flex: { flex: 1 },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm },
  acctCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  acctIcon: { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  acctTitle: { ...Typography.labelLg, color: Colors.onSurface },
  acctSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: Colors.secondary, marginHorizontal: Spacing.containerMargin, marginTop: Spacing.md,
  },
  addText: { ...Typography.labelLg, color: Colors.secondary },
  section: { marginTop: Spacing.lg },
  histCard: {
    marginHorizontal: Spacing.containerMargin, backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  histIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  histName: { ...Typography.labelLg, color: Colors.onSurface },
  histSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  histAmount: { ...Typography.labelLg, color: Colors.teal },
  histDivider: { height: 1, backgroundColor: Colors.surfaceContainerLow },
});
