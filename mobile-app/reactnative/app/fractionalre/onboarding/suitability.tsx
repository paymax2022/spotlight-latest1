import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SegmentedControl from '@/components/SegmentedControl';
import { useSubmitSuitability } from '@/features/fractionalre/hooks';
import type { SuitabilityInput } from '@/features/fractionalre/types';

export default function SuitabilityScreen() {
  const submit = useSubmitSuitability();
  const [income, setIncome] = useState('');
  const [netWorth, setNetWorth] = useState('');
  const [horizon, setHorizon] = useState<SuitabilityInput['investmentHorizon']>('medium');
  const [risk, setRisk] = useState<SuitabilityInput['riskTolerance']>('medium');
  const [experience, setExperience] = useState<SuitabilityInput['experience']>('some');
  const [accepted, setAccepted] = useState(false);

  const incomeKobo = Math.round((parseFloat(income) || 0) * 100);
  const netWorthKobo = Math.round((parseFloat(netWorth) || 0) * 100);
  const canSubmit = incomeKobo > 0 && netWorthKobo > 0 && accepted && !submit.isPending;

  const onSubmit = async () => {
    try {
      await submit.mutateAsync({
        annualIncomeKobo: incomeKobo,
        netWorthKobo,
        investmentHorizon: horizon,
        riskTolerance: risk,
        experience,
        acceptedDeclaration: accepted,
      });
      router.replace('/fractionalre/onboarding/success');
    } catch {
      Alert.alert('Could not submit', 'Please check your entries and try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Suitability" subtitle="Helps us match you to suitable offerings" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>Financial declaration</Text>
        <TextInputField label="Annual income (₦)" value={income} onChangeText={(t) => setIncome(t.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="e.g. 5,000,000" />
        <TextInputField label="Net worth (₦)" value={netWorth} onChangeText={(t) => setNetWorth(t.replace(/[^0-9.]/g, ''))} keyboardType="numeric" placeholder="e.g. 20,000,000" />

        <Text style={styles.section}>Investment horizon</Text>
        <SegmentedControl
          options={[{ value: 'short', label: '< 2 yrs' }, { value: 'medium', label: '2–5 yrs' }, { value: 'long', label: '5+ yrs' }]}
          value={horizon} onChange={setHorizon}
        />

        <Text style={styles.section}>Risk tolerance</Text>
        <SegmentedControl
          options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]}
          value={risk} onChange={setRisk}
        />

        <Text style={styles.section}>Experience</Text>
        <SegmentedControl
          options={[{ value: 'none', label: 'New' }, { value: 'some', label: 'Some' }, { value: 'experienced', label: 'Experienced' }]}
          value={experience} onChange={setExperience}
        />

        <Pressable style={styles.checkRow} onPress={() => setAccepted((a) => !a)}>
          <View style={[styles.checkbox, accepted && styles.checkboxOn]}>
            {accepted ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
          </View>
          <Text style={styles.checkLabel}>
            I declare the information above is accurate and understand my suitability profile and
            annual limit are set from these answers.
          </Text>
        </Pressable>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Submit" onPress={onSubmit} disabled={!canSubmit} loading={submit.isPending} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.sm },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkLabel: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 19 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
