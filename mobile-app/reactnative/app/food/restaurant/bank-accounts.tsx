import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Trash2, Star, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import {
  useBankAccounts, useAddBankAccount, useSetDefaultBankAccount, useDeleteBankAccount,
} from '@/features/restaurantmerchant/hooks';
import type { BankAccount } from '@/features/restaurantmerchant/types';

export default function BankAccountsScreen() {
  const accounts = useBankAccounts();
  const add = useAddBankAccount();
  const setDefault = useSetDefaultBankAccount();
  const del = useDeleteBankAccount();

  const [bankName, setBankName] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');

  const valid = bankName.trim() && bankCode.trim() && /^\d{10}$/.test(number.trim()) && name.trim();
  const submit = () => {
    if (!valid) return;
    add.mutate(
      { bankName: bankName.trim(), bankCode: bankCode.trim(), accountNumber: number.trim(), accountName: name.trim() },
      {
        onSuccess: () => { setBankName(''); setBankCode(''); setNumber(''); setName(''); },
        onError: (e: any) => Alert.alert('Could not save account', e?.message ?? 'Please check the details and try again.'),
      },
    );
  };
  const confirmDelete = (a: BankAccount) =>
    Alert.alert('Remove account', `Delete ${a.bankName} ${a.accountNumberMasked}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => del.mutate(a.id) },
    ]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Payout accounts" />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.lead}>
          Where your earnings are paid out. Withdrawals to your bank are coming soon — for now, saved accounts are used when payouts run.
        </Text>

        <Text style={styles.section}>Saved accounts</Text>
        {accounts.isLoading ? (
          <StateView kind="loading" compact title="Loading accounts" />
        ) : accounts.isError ? (
          <StateView kind="error" compact title="Couldn't load accounts" actionLabel="Retry" onAction={() => accounts.refetch()} />
        ) : (accounts.data?.length ?? 0) === 0 ? (
          <Text style={styles.muted}>No accounts yet. Add one below.</Text>
        ) : (
          <View style={{ gap: Spacing.sm }}>
            {accounts.data?.map((a) => (
              <View key={a.id} style={styles.card}>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowCenter}>
                    <Text style={styles.bank}>{a.bankName}</Text>
                    {a.isDefault ? <View style={styles.defaultPill}><Text style={styles.defaultPillText}>Default</Text></View> : null}
                    {a.isVerified ? <CheckCircle2 size={15} color={Colors.tertiaryContainer} /> : null}
                  </View>
                  <Text style={styles.muted}>{a.accountNumberMasked} · {a.accountName}</Text>
                </View>
                {!a.isDefault ? (
                  <Pressable onPress={() => setDefault.mutate(a.id)} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Make default">
                    <Star size={18} color={Colors.primary} />
                  </Pressable>
                ) : null}
                <Pressable onPress={() => confirmDelete(a)} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Remove">
                  <Trash2 size={18} color={Colors.error} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.section}>Add an account</Text>
        <View style={styles.card}>
          <View style={{ flex: 1, gap: Spacing.sm }}>
            <Field label="Bank name" value={bankName} onChangeText={setBankName} placeholder="GTBank" />
            <Field label="Bank code" value={bankCode} onChangeText={setBankCode} placeholder="058" keyboardType="numeric" />
            <Field label="Account number" value={number} onChangeText={setNumber} placeholder="0123456789" keyboardType="numeric" maxLength={10} />
            <Field label="Account name" value={name} onChangeText={setName} placeholder="As it appears at your bank" />
            <PrimaryButton label="Save account" onPress={submit} loading={add.isPending} disabled={!valid} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label, value, onChangeText, placeholder, keyboardType, maxLength,
}: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'numeric'; maxLength?: number;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder}
        placeholderTextColor={Colors.outline} keyboardType={keyboardType ?? 'default'} maxLength={maxLength}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl },
  lead: { color: Colors.onSurfaceVariant, fontSize: 14 },
  section: { color: Colors.onSurface, fontSize: 16, fontWeight: '700', marginTop: Spacing.sm },
  muted: { color: Colors.onSurfaceVariant, fontSize: 13 },
  label: { color: Colors.onSurfaceVariant, fontSize: 13, fontWeight: '600' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md,
  },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bank: { color: Colors.onSurface, fontSize: 16, fontWeight: '700' },
  input: {
    borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 10, color: Colors.onSurface, fontSize: 15,
    backgroundColor: Colors.background,
  },
  iconBtn: { padding: 4 },
  defaultPill: { backgroundColor: Colors.primary, borderRadius: Radius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  defaultPillText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
