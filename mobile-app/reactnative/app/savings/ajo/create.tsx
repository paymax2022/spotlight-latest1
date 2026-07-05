import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import DisclosureBanner from '@/features/savings/components/DisclosureBanner';
import { useCreateCircle } from '@/features/savings/hooks';
import { FREQUENCIES, AJO_ROTATION_DISCLOSURE, formatNaira } from '@/features/savings/constants/savings.constants';
import type { SaveFrequency } from '@/features/savings/types';

export default function CreateCircle() {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [members, setMembers] = useState('5');
  const [freq, setFreq] = useState<SaveFrequency>('monthly');
  const create = useCreateCircle();

  const amountKobo = amount ? Math.round(parseFloat(amount) * 100) : 0;
  const memberCount = parseInt(members, 10) || 0;
  const valid = name.trim().length >= 2 && amountKobo > 0 && memberCount >= 2;
  const potKobo = amountKobo * memberCount;

  const submit = async () => {
    if (!valid) return;
    try {
      const c = await create.mutateAsync({ name: name.trim(), contributionKobo: amountKobo, frequency: freq, memberCount });
      router.replace(`/savings/ajo/${c.id}`);
    } catch {
      Alert.alert('Could not create circle', 'Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create Ajo circle" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TextInputField label="Circle name" placeholder="e.g. Office Ajo" value={name} onChangeText={setName} />
        <TextInputField label="Contribution per member" placeholder="0" keyboardType="numeric" value={amount} onChangeText={setAmount} />
        <TextInputField label="Number of members" placeholder="5" keyboardType="numeric" value={members} onChangeText={setMembers} />

        <Text style={styles.label}>Frequency</Text>
        <SegmentedControl<SaveFrequency> options={FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))} value={freq} onChange={setFreq} />

        {valid ? <Text style={styles.hint}>Each cycle pays out {formatNaira(potKobo)} to one member, in rotation.</Text> : null}

        <DisclosureBanner text={AJO_ROTATION_DISCLOSURE} tone="warn" />
        <PrimaryButton label="Create circle" onPress={submit} disabled={!valid} loading={create.isPending} style={{ marginTop: Spacing.sm }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
