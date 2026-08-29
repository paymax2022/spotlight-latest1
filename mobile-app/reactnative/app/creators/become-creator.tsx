import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { X, ArrowLeft, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useBecomeCreator } from '@/features/creators/hooks';
import { CreatorsColors, NL5_DISCLOSURE, PAYOUT_KYC_NOTICE } from '@/features/creators/constants/creators.constants';

const CATEGORIES = ['Music', 'Comedy', 'Education', 'Gaming', 'Food', 'Lifestyle', 'Fitness'];
const STEPS = ['Profile', 'Category & bio', 'Payout KYC', 'Confirm'];

export default function BecomeCreator() {
  const become = useBecomeCreator();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [category, setCategory] = useState('');
  const [bio, setBio] = useState('');
  const [legalName, setLegalName] = useState('');
  const [kycRef, setKycRef] = useState('');
  const [accepted, setAccepted] = useState(false);

  const canNext =
    (step === 0 && displayName.trim().length > 1 && handle.trim().length > 2) ||
    (step === 1 && !!category && bio.trim().length > 4) ||
    (step === 2 && legalName.trim().length > 2 && kycRef.trim().length > 4) ||
    (step === 3 && accepted);

  const submit = async () => {
    await become.mutateAsync({ displayName, handle, category, bio, legalName, kycRef, acceptedTerms: accepted });
    setDone(true);
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}><Pressable onPress={() => goBack('/creators')} hitSlop={10} style={styles.iconBtn}><X size={22} color={Colors.onSurface} /></Pressable><Text style={styles.headerTitle}>Submitted</Text><View style={styles.iconBtn} /></View>
        <StateView kind="empty" icon="CheckCircle2" title="Application submitted" message="We're reviewing your creator profile and payout KYC. You'll be notified once approved." actionLabel="Done" onAction={() => goBack('/creators')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => (step === 0 ? goBack('/creators') : setStep(step - 1))} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Back">
          {step === 0 ? <X size={22} color={Colors.onSurface} /> : <ArrowLeft size={22} color={Colors.onSurface} />}
        </Pressable>
        <Text style={styles.headerTitle}>Become a creator</Text>
        <View style={styles.iconBtn} />
      </View>

      {/* Step indicator */}
      <View style={styles.steps}>
        {STEPS.map((s, i) => (
          <View key={s} style={styles.stepWrap}>
            <View style={[styles.dot, i <= step && styles.dotActive]}>{i < step ? <Check size={12} color="#FFFFFF" /> : <Text style={[styles.dotNum, i <= step && styles.dotNumActive]}>{i + 1}</Text>}</View>
            {i < STEPS.length - 1 ? <View style={[styles.bar, i < step && styles.barActive]} /> : null}
          </View>
        ))}
      </View>
      <Text style={styles.stepLabel}>{STEPS[step]}</Text>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {step === 0 && (
          <>
            <Text style={styles.label}>Display name</Text>
            <TextInput style={styles.input} placeholder="e.g. Tope Beats" placeholderTextColor={CreatorsColors.muted} value={displayName} onChangeText={setDisplayName} />
            <Text style={styles.label}>Handle</Text>
            <TextInput style={styles.input} placeholder="@yourhandle" placeholderTextColor={CreatorsColors.muted} autoCapitalize="none" value={handle} onChangeText={setHandle} />
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.label}>Category</Text>
            <View style={styles.chipGrid}>
              {CATEGORIES.map((c) => (
                <Pressable key={c} style={[styles.chip, category === c && styles.chipSel]} onPress={() => setCategory(c)}>
                  <Text style={[styles.chipText, category === c && styles.chipTextSel]}>{c}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Bio</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="Tell fans what you create…" placeholderTextColor={CreatorsColors.muted} value={bio} onChangeText={setBio} multiline />
          </>
        )}

        {step === 2 && (
          <>
            <View style={styles.notice}><Text style={styles.noticeText}>{PAYOUT_KYC_NOTICE}</Text></View>
            <Text style={styles.label}>Legal full name</Text>
            <TextInput style={styles.input} placeholder="As on your ID" placeholderTextColor={CreatorsColors.muted} value={legalName} onChangeText={setLegalName} />
            <Text style={styles.label}>BVN / NIN reference</Text>
            <TextInput style={styles.input} placeholder="11-digit reference" placeholderTextColor={CreatorsColors.muted} keyboardType="number-pad" value={kycRef} onChangeText={setKycRef} />
          </>
        )}

        {step === 3 && (
          <>
            <View style={styles.summary}>
              <SummaryRow label="Name" value={displayName} />
              <SummaryRow label="Handle" value={handle} />
              <SummaryRow label="Category" value={category} />
              <SummaryRow label="Legal name" value={legalName} />
              <SummaryRow label="KYC ref" value={kycRef ? `••••${kycRef.slice(-4)}` : ''} />
            </View>
            <View style={styles.disclosure}><Text style={styles.disclosureText}>{NL5_DISCLOSURE}</Text></View>
            <Pressable style={styles.checkRow} onPress={() => setAccepted(!accepted)}>
              <View style={[styles.checkbox, accepted && styles.checkboxOn]}>{accepted ? <Check size={14} color="#FFFFFF" /> : null}</View>
              <Text style={styles.checkText}>I confirm my details are accurate and accept the Creator terms.</Text>
            </Pressable>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={step === STEPS.length - 1 ? 'Submit application' : 'Continue'}
          onPress={() => (step === STEPS.length - 1 ? submit() : setStep(step + 1))}
          disabled={!canNext}
          loading={become.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.sumRow}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={styles.sumValue}>{value || '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  steps: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.sm },
  stepWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  dot: { width: 26, height: 26, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: CreatorsColors.surfaceAlt },
  dotActive: { backgroundColor: CreatorsColors.brand },
  dotNum: { ...Typography.labelSm, color: CreatorsColors.muted },
  dotNumActive: { color: '#FFFFFF' },
  bar: { flex: 1, height: 2, backgroundColor: CreatorsColors.border, marginHorizontal: 4 },
  barActive: { backgroundColor: CreatorsColors.brand },
  stepLabel: { ...Typography.labelMd, color: CreatorsColors.muted, paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.sm },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  label: { ...Typography.labelMd, color: CreatorsColors.text, marginTop: Spacing.md, marginBottom: 6 },
  input: { ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1, borderColor: CreatorsColors.border, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: 14, backgroundColor: CreatorsColors.surface },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 10, borderRadius: Radius.full, borderWidth: 1.5, borderColor: CreatorsColors.border, backgroundColor: CreatorsColors.surface },
  chipSel: { borderColor: CreatorsColors.brand, backgroundColor: CreatorsColors.brandBg },
  chipText: { ...Typography.labelMd, color: CreatorsColors.text },
  chipTextSel: { color: CreatorsColors.brand },
  notice: { backgroundColor: CreatorsColors.brandBg, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  noticeText: { ...Typography.labelSm, color: CreatorsColors.text },
  summary: { backgroundColor: CreatorsColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, gap: Spacing.sm },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sumLabel: { ...Typography.bodySm, color: CreatorsColors.muted },
  sumValue: { ...Typography.labelMd, color: CreatorsColors.text },
  disclosure: { backgroundColor: CreatorsColors.warnBg, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.md },
  disclosureText: { ...Typography.labelSm, color: CreatorsColors.warnText },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.md },
  checkbox: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 2, borderColor: CreatorsColors.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: CreatorsColors.brand, borderColor: CreatorsColors.brand },
  checkText: { ...Typography.bodySm, color: CreatorsColors.text, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
