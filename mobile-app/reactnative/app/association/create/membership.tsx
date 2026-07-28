import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, X, Layers } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import WizardProgress from '@/features/association/components/WizardProgress';
import { useOrgDraft } from '@/features/association/store/orgDraftStore';
import { CADENCE_OPTIONS, MEMBERSHIP_CATEGORY_OPTIONS } from '@/features/association/constants/orgWizard.constants';
import { CADENCE_LABEL } from '@/features/association/constants/association.constants';
import { formatNaira } from '@/features/association/utils/associationFormatters';
import type { DuesCadence } from '@/features/association/types/association.types';

export default function WizardMembership() {
  const { draft, addCategory, removeCategory } = useOrgDraft();
  const [touched, setTouched] = useState(false);
  const [category, setCategory] = useState('');   // dropdown selection
  const [customLabel, setCustomLabel] = useState(''); // used when "Other"
  const [dues, setDues] = useState('');
  const [cadence, setCadence] = useState<DuesCadence>('ANNUAL');

  // The effective category name: the picked option, or the custom text for "Other".
  const effectiveLabel = (category === 'Other' ? customLabel : category).trim();
  const valid = draft.categories.length > 0;

  const onAdd = () => {
    if (!effectiveLabel) return;
    const naira = parseInt(dues.replace(/[^0-9]/g, ''), 10) || 0;
    addCategory({ id: `cat_${Date.now()}`, label: effectiveLabel, duesKobo: naira * 100, cadence });
    setCategory(''); setCustomLabel(''); setDues('');
  };
  const next = () => { setTouched(true); if (valid) router.push('/association/create/access'); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create organisation" />
      <WizardProgress step={3} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Membership categories</Text>
        <Text style={styles.help}>Add at least one category with its dues.</Text>
        {touched && !valid ? <Text style={styles.error}>Add at least one category</Text> : null}

        {draft.categories.length > 0 ? (
          <View style={styles.gap}>
            {draft.categories.map((c) => (
              <View key={c.id} style={[styles.row, shadow1]}>
                <Layers size={16} color={Colors.secondary} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{c.label}</Text>
                  <Text style={styles.rowMeta}>{c.duesKobo === 0 ? 'Free' : `${formatNaira(c.duesKobo)} · ${CADENCE_LABEL[c.cadence]}`}</Text>
                </View>
                <Pressable onPress={() => removeCategory(c.id)} hitSlop={8} accessibilityLabel={`Remove ${c.label}`}>
                  <X size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.addCard}>
          <SelectField
            placeholder="Select membership category"
            value={category}
            options={[...MEMBERSHIP_CATEGORY_OPTIONS]}
            onChange={setCategory}
          />
          {category === 'Other' ? (
            <TextInputField placeholder="Enter category name" value={customLabel} onChangeText={setCustomLabel} />
          ) : null}
          <TextInputField placeholder="Dues amount (₦)" value={dues} onChangeText={setDues} keyboardType="number-pad" />
          <SelectField
            value={CADENCE_LABEL[cadence]}
            options={CADENCE_OPTIONS.map((c) => CADENCE_LABEL[c])}
            onChange={(lbl) => {
              const found = (CADENCE_OPTIONS as readonly DuesCadence[]).find((c) => CADENCE_LABEL[c] === lbl);
              if (found) setCadence(found);
            }}
            searchable={false}
          />
          <Pressable onPress={onAdd} style={[styles.addBtn, !effectiveLabel && styles.addBtnDisabled]} disabled={!effectiveLabel} accessibilityRole="button" accessibilityLabel="Add category">
            <Plus size={16} color={Colors.onPrimary} strokeWidth={2.4} />
            <Text style={styles.addText}>Add category</Text>
          </Pressable>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Continue" onPress={next} disabled={touched && !valid} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.sm, paddingTop: Spacing.sm },
  label: { ...Typography.titleMd, color: Colors.onSurface },
  help: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  error: { ...Typography.labelSm, color: Colors.error },
  gap: { gap: Spacing.sm, marginTop: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  rowLabel: { ...Typography.labelMd, color: Colors.onSurface },
  rowMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  addCard: { gap: Spacing.sm, marginTop: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primary },
  addBtnDisabled: { opacity: 0.4 },
  addText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
