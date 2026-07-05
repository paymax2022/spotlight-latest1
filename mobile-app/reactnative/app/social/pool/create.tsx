import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useCreatePool } from '@/features/social/hooks';
import { SocialColors, formatNaira } from '@/features/social/constants/social.constants';

const PAYOUT_RULES = [
  'Organiser withdraws on the event date.',
  'Released to verified beneficiary.',
  'Withdraw anytime by organiser.',
];

export default function CreatePool() {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [goal, setGoal] = useState('');
  const [rule, setRule] = useState(PAYOUT_RULES[0]);
  const create = useCreatePool();

  const goalKobo = goal ? Math.round(parseFloat(goal) * 100) : null;
  const valid = title.trim().length >= 2;

  const submit = async () => {
    if (!valid) return;
    try {
      const p = await create.mutateAsync({ title: title.trim(), description: desc.trim() || undefined, goalKobo, payoutRule: rule });
      router.replace(`/social/pool/${p.id}`);
    } catch {
      Alert.alert('Could not create pool', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Start a pool" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TextInputField label="Pool name" placeholder="e.g. Tunde's Birthday" value={title} onChangeText={setTitle} />
        <TextInputField label="Description (optional)" placeholder="What's this pool for?" value={desc} onChangeText={setDesc} multiline />
        <TextInputField label="Goal amount (optional)" placeholder="0" keyboardType="numeric" value={goal} onChangeText={setGoal} />

        <Text style={styles.label}>Payout rule</Text>
        {PAYOUT_RULES.map((r) => (
          <Pressable key={r} onPress={() => setRule(r)} style={[styles.ruleCard, rule === r && styles.ruleCardActive]}>
            <View style={[styles.radio, rule === r && styles.radioActive]} />
            <Text style={styles.ruleText}>{r}</Text>
          </Pressable>
        ))}

        {goalKobo ? <Text style={styles.hint}>Goal: {formatNaira(goalKobo)}</Text> : null}
        <PrimaryButton label="Create pool" onPress={submit} disabled={!valid} loading={create.isPending} style={{ marginTop: Spacing.sm }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  label: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm },
  ruleCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: SocialColors.surface, borderWidth: 2, borderColor: SocialColors.border },
  ruleCardActive: { borderColor: SocialColors.brand },
  radio: { width: 20, height: 20, borderRadius: Radius.full, borderWidth: 2, borderColor: SocialColors.border },
  radioActive: { borderColor: SocialColors.brand, backgroundColor: SocialColors.brand },
  ruleText: { ...Typography.bodyMd, color: SocialColors.text, flex: 1 },
  hint: { ...Typography.bodySm, color: SocialColors.muted },
});
