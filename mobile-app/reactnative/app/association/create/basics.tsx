import React, { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import WizardProgress from '@/features/association/components/WizardProgress';
import { useOrgDraft } from '@/features/association/store/orgDraftStore';

const CATEGORIES = ['Professional body', 'Alumni', 'Estate / residents', 'Cooperative', 'Trade union', 'Religious', 'Community', 'Other'];

export default function WizardBasics() {
  const { draft, patch } = useOrgDraft();
  const [touched, setTouched] = useState(false);

  const valid = draft.name.trim().length > 2 && Boolean(draft.category);

  const next = () => {
    setTouched(true);
    if (valid) router.push('/association/create/branding');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create organisation" />
      <WizardProgress step={0} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInputField label="Organisation name" placeholder="e.g. Nigerian Medical Association" value={draft.name} onChangeText={(t) => patch({ name: t })} error={touched && draft.name.trim().length <= 2 ? 'Enter a name' : undefined} />
        <TextInputField label="Acronym (optional)" placeholder="e.g. NMA" value={draft.acronym} onChangeText={(t) => patch({ acronym: t })} autoCapitalize="characters" />
        <SelectField label="Category" placeholder="Select a category" value={draft.category} options={CATEGORIES} onChange={(v) => patch({ category: v })} error={touched && !draft.category ? 'Choose a category' : undefined} />
        <TextInputField label="Description" placeholder="What is this organisation about?" value={draft.description} onChangeText={(t) => patch({ description: t })} multiline numberOfLines={4} />
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Continue" onPress={next} disabled={touched && !valid} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md, paddingTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
