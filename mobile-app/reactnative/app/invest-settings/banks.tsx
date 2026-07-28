import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, Modal, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import BankRow from '@/features/investsettings/components/BankRow';
import { useLinkedBanks, useAddBank, useRemoveBank } from '@/features/investsettings/hooks/useSettings';

const BANK_OPTIONS = [
  'Guaranty Trust Bank', 'Access Bank', 'Zenith Bank', 'First Bank of Nigeria',
  'United Bank for Africa', 'Kuda Microfinance Bank', 'Opay', 'Stanbic IBTC Bank',
];

export default function BanksScreen() {
  const { data, isLoading, isError, refetch } = useLinkedBanks();
  const addBank = useAddBank();
  const removeBank = useRemoveBank();

  const [open, setOpen] = useState(false);
  const [bankName, setBankName] = useState('');
  const [account, setAccount] = useState('');
  const [error, setError] = useState<string | undefined>();

  const submit = () => {
    if (!bankName) { setError('Select a bank.'); return; }
    if (account.replace(/\D/g, '').length !== 10) { setError('Enter a valid 10-digit account number.'); return; }
    setError(undefined);
    addBank.mutate(
      { bankName, accountNumber: account },
      { onSuccess: () => { setOpen(false); setBankName(''); setAccount(''); } },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Linked banks"
        subtitle="Fund & withdraw accounts"
        rightSlot={
          <Pressable onPress={() => setOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Add bank">
            <Plus size={22} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading banks…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load banks" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (data ?? []).length === 0 ? (
        <StateView
          kind="empty" icon="Landmark" title="No linked banks"
          message="Link a bank account to fund your wallet and withdraw."
          actionLabel="Add bank" onAction={() => setOpen(true)}
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <BankRow
              bank={item}
              removing={removeBank.isPending}
              onRemove={() => removeBank.mutate(item.id)}
            />
          )}
        />
      )}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Add a bank</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
              </Pressable>
            </View>
            <SelectField label="Bank" placeholder="Select your bank" value={bankName || undefined} options={BANK_OPTIONS} onChange={setBankName} />
            <TextInputField
              label="Account number"
              placeholder="0123456789"
              keyboardType="number-pad"
              maxLength={10}
              value={account}
              onChangeText={(t) => setAccount(t.replace(/\D/g, ''))}
              error={error}
            />
            <PrimaryButton label="Link bank" onPress={submit} loading={addBank.isPending} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.sm },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.containerMargin, paddingBottom: 40,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh,
    alignSelf: 'center', marginTop: Spacing.sm, marginBottom: Spacing.md,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle: { ...Typography.titleMd, color: Colors.onSurface },
});
