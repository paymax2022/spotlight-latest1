import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Landmark, Plus, Check, BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useBankAccounts } from '@/features/crowdfunding/hooks/useExtras';

export default function BankAccountsScreen() {
  const { data, isLoading, isError, refetch } = useBankAccounts();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Bank accounts"
        rightSlot={<Pressable hitSlop={8} onPress={() => router.push('/crowdfunding/settings/add-bank')} accessibilityLabel="Add bank account"><Plus size={22} color={Colors.primary} strokeWidth={2.2} /></Pressable>}
      />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load accounts" actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>Verified accounts where approved withdrawals are paid out.</Text>
          {(data ?? []).map((b) => (
            <View key={b.id} style={styles.card}>
              <View style={styles.iconBox}><Landmark size={20} color={Colors.primary} strokeWidth={2} /></View>
              <View style={styles.cardBody}>
                <View style={styles.nameRow}>
                  <Text style={styles.bank}>{b.bankName}</Text>
                  <BadgeCheck size={15} color={Colors.tertiaryContainer} strokeWidth={2.2} />
                </View>
                <Text style={styles.acct}>{b.accountNumberMasked} · {b.accountName}</Text>
              </View>
              {b.isDefault ? (
                <View style={styles.defaultChip}><Check size={12} color={Colors.onPrimary} strokeWidth={3} /><Text style={styles.defaultText}>Default</Text></View>
              ) : (
                <Pressable hitSlop={8} accessibilityRole="button"><Text style={styles.setDefault}>Set default</Text></Pressable>
              )}
            </View>
          ))}
          {(data ?? []).length === 0 && (
            <StateView kind="empty" icon="Landmark" title="No bank accounts" message="Add a verified bank account to receive withdrawals." />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: 60, gap: Spacing.sm },
  intro: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bank: { ...Typography.labelLg, color: Colors.onSurface },
  acct: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  defaultChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  defaultText: { ...Typography.caption, color: Colors.onPrimary, fontWeight: '600' as const },
  setDefault: { ...Typography.labelSm, color: Colors.secondary },
});
