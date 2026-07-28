import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckSquare, Square, UserPlus, Upload, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useOrganisation, useSubmitApplication } from '@/features/association/hooks/useAssociation';
import { formatNaira } from '@/features/association/utils/associationFormatters';

export default function JoinOrganisation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const org = useOrganisation(id);
  const submit = useSubmitApplication();

  const [category, setCategory] = useState('');
  const [chapter, setChapter] = useState('');
  const [branch, setBranch] = useState('');
  const [committees, setCommittees] = useState<string[]>([]);
  const [sponsor, setSponsor] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [touched, setTouched] = useState(false);

  const toggleCommittee = (name: string) =>
    setCommittees((cur) => (cur.includes(name) ? cur.filter((c) => c !== name) : [...cur, name]));

  const o = org.data;
  const categoryOptions = useMemo(() => o?.membershipCategories.map((c) => c.label) ?? [], [o]);
  const chapterOptions = useMemo(() => o?.chapters.map((c) => c.name) ?? [], [o]);
  const needsSponsor = o?.requirements.some((r) => r.type === 'SPONSOR') ?? false;

  if (org.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Join" />
        <StateView kind="loading" message="Loading…" />
      </SafeAreaView>
    );
  }
  if (org.isError || !o) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Join" />
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => org.refetch()} />
      </SafeAreaView>
    );
  }

  const valid = Boolean(category) && Boolean(chapter) && accepted;

  const onSubmit = () => {
    setTouched(true);
    if (!valid) return;
    const cat = o.membershipCategories.find((c) => c.label === category);
    const ch = o.chapters.find((c) => c.name === chapter);
    submit.mutate(
      {
        organisationId: o.id,
        categoryId: cat?.id ?? null,
        chapterId: ch?.id ?? null,
        localBranch: branch || null,
        committeeInterests: committees,
        sponsorName: sponsor.trim() || null,
        documents: [],
        acceptedRules: accepted,
      },
      {
        onSuccess: (res) =>
          router.replace(`/association/join/${o.id}/submitted?status=${res.status}&app=${res.applicationId}`),
        onError: () => Alert.alert('Something went wrong', 'Could not submit your application. Please try again.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={`Join ${o.acronym ?? o.name}`} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Complete the details below to apply. {o.approvalSummary}</Text>

        <SelectField
          label="Membership category"
          placeholder="Select a category"
          value={category}
          options={categoryOptions}
          onChange={setCategory}
          error={touched && !category ? 'Please choose a category' : undefined}
        />

        <SelectField
          label="Chapter / state"
          placeholder="Select your chapter"
          value={chapter}
          options={chapterOptions}
          onChange={setChapter}
          error={touched && !chapter ? 'Please choose a chapter' : undefined}
        />

        {o.branches.length > 0 ? (
          <SelectField
            label="Local branch (optional)"
            placeholder="Select your local branch"
            value={branch}
            options={o.branches}
            onChange={setBranch}
          />
        ) : null}

        {o.committeeOptions.length > 0 ? (
          <View>
            <Text style={styles.committeeLabel}>Committee interest (optional)</Text>
            <View style={styles.committeeRow}>
              {o.committeeOptions.map((name) => {
                const active = committees.includes(name);
                return (
                  <Pressable
                    key={name}
                    onPress={() => toggleCommittee(name)}
                    style={[styles.committeeChip, active && styles.committeeChipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={name}
                  >
                    <Text style={[styles.committeeText, active && styles.committeeTextActive]}>{name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {needsSponsor ? (
          <TextInputField
            label="Sponsor / referrer (optional)"
            placeholder="Full name of a sponsoring member"
            value={sponsor}
            onChangeText={setSponsor}
            leftIcon={<UserPlus size={18} color={Colors.outline} strokeWidth={2} />}
          />
        ) : null}

        {/* Required documents step */}
        {o.requirements.some((r) => r.type === 'DOCUMENT') ? (
          <Pressable style={styles.docsRow} onPress={() => router.push(`/association/join/${o.id}/documents`)} accessibilityRole="button" accessibilityLabel="Upload required documents">
            <Upload size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.docsText}>Upload required documents</Text>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        ) : null}

        {/* Rules consent */}
        <Text style={styles.rulesTitle}>Group rules</Text>
        <View style={styles.rulesCard}>
          {o.rules.map((rule, i) => (
            <Text key={i} style={styles.ruleText}>• {rule}</Text>
          ))}
        </View>

        <Pressable
          onPress={() => setAccepted((a) => !a)}
          style={styles.consentRow}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}
          accessibilityLabel="I accept the group rules"
        >
          {accepted
            ? <CheckSquare size={22} color={Colors.primary} strokeWidth={2} />
            : <Square size={22} color={Colors.outline} strokeWidth={2} />}
          <Text style={styles.consentText}>I have read and accept the group rules.</Text>
        </Pressable>
        {touched && !accepted ? <Text style={styles.consentError}>You must accept the rules to continue.</Text> : null}

        {o.requiresPayment ? (
          <View style={styles.feeNote}>
            <Text style={styles.feeLabel}>Registration fee</Text>
            <Text style={styles.feeAmount}>{formatNaira(o.registrationFeeKobo)}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={o.requiresPayment ? 'Continue to payment' : 'Submit application'}
          onPress={onSubmit}
          loading={submit.isPending}
          disabled={touched && !valid}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.md, paddingTop: Spacing.sm },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  committeeLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  committeeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  committeeChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  committeeChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  committeeText: { ...Typography.labelMd, color: Colors.onSurface },
  committeeTextActive: { color: Colors.onPrimary },
  docsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  docsText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  rulesTitle: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.xs },
  rulesCard: {
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    padding: Spacing.md, gap: 6,
  },
  ruleText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  consentText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  consentError: { ...Typography.labelSm, color: Colors.error, marginTop: -Spacing.sm },
  feeNote: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.xs,
  },
  feeLabel: { ...Typography.labelMd, color: Colors.primary },
  feeAmount: { ...Typography.titleMd, color: Colors.primary },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
});
