import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Check, BadgeCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';

const BANKS = ['Access Bank', 'GTBank', 'Zenith Bank', 'UBA', 'First Bank', 'Kuda', 'Opay', 'Moniepoint'];

export default function AddBankScreen() {
  const [bank, setBank] = useState<string | null>(null);
  const [account, setAccount] = useState('');
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const onAccount = (t: string) => {
    const digits = t.replace(/\D/g, '').slice(0, 10);
    setAccount(digits);
    setResolvedName(null);
    if (digits.length === 10 && bank) {
      setResolving(true);
      setTimeout(() => { setResolving(false); setResolvedName('ADAEZE OKONKWO'); }, 800);
    }
  };

  const valid = bank && account.length === 10 && resolvedName;
  const save = () => { setSaving(true); setTimeout(() => { setSaving(false); setDone(true); }, 700); };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Bank added" showBack={false} />
        <StateView kind="empty" icon="BadgeCheck" title="Bank account verified" message="Your bank account has been added and verified for withdrawals." actionLabel="Done" onAction={() => goBack('/crowdfunding/settings')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Add bank account" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Bank</Text>
          <View style={styles.bankWrap}>
            {BANKS.map((b) => {
              const active = bank === b;
              return (
                <Pressable key={b} style={[styles.bankChip, active && styles.bankChipActive]} onPress={() => { setBank(b); setResolvedName(null); if (account.length === 10) onAccount(account); }} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                  <Text style={[styles.bankChipText, active && styles.bankChipTextActive]}>{b}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ height: Spacing.lg }} />
          <TextInputField label="Account number" value={account} onChangeText={onAccount} keyboardType="number-pad" placeholder="10-digit NUBAN" />

          {resolving && <Text style={styles.resolving}>Verifying account…</Text>}
          {resolvedName && (
            <View style={styles.resolved}>
              <BadgeCheck size={16} color={Colors.tertiaryContainer} strokeWidth={2.2} />
              <Text style={styles.resolvedText}>{resolvedName}</Text>
              <Check size={16} color={Colors.tertiaryContainer} strokeWidth={2.4} />
            </View>
          )}
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Add bank account" onPress={save} disabled={!valid} loading={saving} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  bankWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  bankChip: { borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, paddingVertical: 9 },
  bankChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  bankChipText: { ...Typography.labelSm, color: Colors.onSurface },
  bankChipTextActive: { color: Colors.onPrimary },
  resolving: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 4 },
  resolved: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md, marginTop: 4 },
  resolvedText: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
