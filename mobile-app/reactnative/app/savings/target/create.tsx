import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Calendar, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import DisclosureBanner from '@/features/savings/components/DisclosureBanner';
import { useCreateGroupTarget } from '@/features/savings/hooks';
import { SavingsColors, GROUP_TARGET_DISCLOSURE, formatNaira } from '@/features/savings/constants/savings.constants';
import type { WithdrawalRule } from '@/features/savings/types';

const RULES: { value: WithdrawalRule; title: string; desc: string }[] = [
  { value: 'on-date', title: 'On target date', desc: 'Funds release automatically on the deadline.' },
  { value: 'majority-approval', title: 'Majority approval', desc: 'Most members must approve a withdrawal.' },
];

export default function CreateGroupTarget() {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('60');
  const [rule, setRule] = useState<WithdrawalRule>('on-date');
  const create = useCreateGroupTarget();

  const targetKobo = amount ? Math.round(parseFloat(amount) * 100) : 0;
  const dayNum = parseInt(days, 10) || 0;
  const valid = name.trim().length >= 2 && targetKobo > 0 && dayNum > 0;

  const submit = async () => {
    if (!valid) return;
    const deadlineISO = new Date(Date.now() + dayNum * 86_400_000).toISOString();
    try {
      const t = await create.mutateAsync({ name: name.trim(), targetKobo, deadlineISO, withdrawalRule: rule });
      router.replace(`/savings/target/${t.id}`);
    } catch {
      Alert.alert('Could not create target', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create group target" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TextInputField label="Target name" placeholder="e.g. Detty December Trip" value={name} onChangeText={setName} />
        <TextInputField label="Target amount" placeholder="0" keyboardType="numeric" value={amount} onChangeText={setAmount} leftIcon={<Users size={18} color={SavingsColors.muted} />} />
        <TextInputField label="Days to reach goal" placeholder="60" keyboardType="numeric" value={days} onChangeText={setDays} leftIcon={<Calendar size={18} color={SavingsColors.muted} />} />

        <Text style={styles.label}>Withdrawal rule</Text>
        {RULES.map((r) => (
          <Pressable key={r.value} onPress={() => setRule(r.value)} style={[styles.ruleCard, rule === r.value && styles.ruleCardActive]}>
            <View style={[styles.radio, rule === r.value && styles.radioActive]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.ruleTitle}>{r.title}</Text>
              <Text style={styles.ruleDesc}>{r.desc}</Text>
            </View>
          </Pressable>
        ))}

        {targetKobo > 0 ? <Text style={styles.hint}>Goal: {formatNaira(targetKobo)}</Text> : null}
        <DisclosureBanner text={GROUP_TARGET_DISCLOSURE} />
        <PrimaryButton label="Create target" onPress={submit} disabled={!valid} loading={create.isPending} style={{ marginTop: Spacing.sm }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  label: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm },
  ruleCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: SavingsColors.surface, borderWidth: 2, borderColor: SavingsColors.border },
  ruleCardActive: { borderColor: SavingsColors.brand },
  radio: { width: 20, height: 20, borderRadius: Radius.full, borderWidth: 2, borderColor: SavingsColors.border, marginTop: 2 },
  radioActive: { borderColor: SavingsColors.brand, backgroundColor: SavingsColors.brand },
  ruleTitle: { ...Typography.labelLg, color: Colors.onSurface },
  ruleDesc: { ...Typography.bodySm, color: SavingsColors.muted },
  hint: { ...Typography.bodySm, color: SavingsColors.muted },
});
