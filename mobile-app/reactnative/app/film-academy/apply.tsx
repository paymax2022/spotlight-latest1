// ── Film Academy — application form (native) ─────────────────────────────────
// Posts to /api/academy/apply, the same endpoint the web form uses. Required by
// the server: full_name, email, phone, batch_id, at least one area of interest,
// and motivation. Those are validated here too so a user is not sent a 400 for
// something the form could have told them immediately.

import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { getOverview, applyToBatch } from '@/features/filmAcademy/api';
import { FILM_ACADEMY_KEY } from './index';

const AREAS = [
  'Directing', 'Screenwriting', 'Cinematography', 'Editing',
  'Sound', 'Producing', 'Production design', 'Acting',
];

export default function FilmAcademyApplyScreen() {
  const { batchId } = useLocalSearchParams<{ batchId?: string }>();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: FILM_ACADEMY_KEY, queryFn: getOverview });
  const batch = data?.batches.find((b) => b.id === batchId);

  const [fullName, setFullName]     = React.useState('');
  const [email, setEmail]           = React.useState('');
  const [phone, setPhone]           = React.useState('');
  const [areas, setAreas]           = React.useState<string[]>([]);
  const [motivation, setMotivation] = React.useState('');
  const [experience, setExperience] = React.useState('');
  const [pref, setPref]             = React.useState<'one_off' | 'installment'>('installment');
  const [busy, setBusy]             = React.useState(false);
  const [error, setError]           = React.useState<string | null>(null);

  const toggleArea = (a: string) =>
    setAreas((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  const onSubmit = async () => {
    setError(null);
    // Mirror the server's required fields rather than discovering them via a 400.
    if (!batchId)            return setError('No cohort selected.');
    if (!fullName.trim())    return setError('Enter your full name.');
    if (!email.trim())       return setError('Enter your email address.');
    if (!phone.trim())       return setError('Enter your phone number.');
    if (areas.length === 0)  return setError('Choose at least one area of interest.');
    if (!motivation.trim())  return setError('Tell us why you want to join.');

    setBusy(true);
    try {
      await applyToBatch({
        batch_id: batchId,
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        areas_of_interest: areas,
        motivation: motivation.trim(),
        experience: experience.trim() || undefined,
        payment_preference: pref,
      });
      await qc.invalidateQueries({ queryKey: FILM_ACADEMY_KEY });
      Alert.alert('Application submitted', 'We will be in touch about next steps.');
      router.back();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Could not submit your application. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <ChevronLeft size={24} color={Colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Apply</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {!!batch && (
          <View style={styles.batchBox}>
            <Text style={styles.batchLabel}>Applying to</Text>
            <Text style={styles.batchName}>{batch.batch_name}</Text>
          </View>
        )}

        <Field label="Full name"     value={fullName} onChange={setFullName} placeholder="Your full name" />
        <Field label="Email"         value={email}    onChange={setEmail}    placeholder="you@example.com"
               keyboardType="email-address" autoCapitalize="none" />
        <Field label="Phone number"  value={phone}    onChange={setPhone}    placeholder="0801 234 5678"
               keyboardType="phone-pad" />

        <Text style={styles.label}>Areas of interest</Text>
        <View style={styles.chips}>
          {AREAS.map((a) => {
            const on = areas.includes(a);
            return (
              <Pressable key={a} onPress={() => toggleArea(a)} style={[styles.chip, on && styles.chipOn]}>
                {on && <Check size={13} color={Colors.primary} />}
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{a}</Text>
              </Pressable>
            );
          })}
        </View>

        <Field label="Why do you want to join?" value={motivation} onChange={setMotivation}
               placeholder="A few sentences" multiline />
        <Field label="Relevant experience (optional)" value={experience} onChange={setExperience}
               placeholder="Any prior work or training" multiline />

        <Text style={styles.label}>How would you like to pay?</Text>
        <View style={styles.chips}>
          {(['installment', 'one_off'] as const).map((p) => (
            <Pressable key={p} onPress={() => setPref(p)} style={[styles.chip, pref === p && styles.chipOn]}>
              <Text style={[styles.chipText, pref === p && styles.chipTextOn]}>
                {p === 'installment' ? 'In instalments' : 'One-off'}
              </Text>
            </Pressable>
          ))}
        </View>

        {!!error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.submit, busy && styles.submitBusy]} onPress={onSubmit} disabled={busy}>
          {busy ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={styles.submitText}>Submit application</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field(props: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  multiline?: boolean; keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={[styles.input, props.multiline && styles.inputMulti]}
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor={Colors.onSurfaceVariant}
        multiline={props.multiline}
        keyboardType={props.keyboardType ?? 'default'}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  back:        { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  scroll:      { padding: Spacing.containerMargin, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  batchBox:    { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.lg },
  batchLabel:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  batchName:   { ...Typography.titleMd, color: Colors.onSurface },
  field:       { gap: 6 },
  label:       { ...Typography.labelMd, color: Colors.onSurface },
  input:       { backgroundColor: Colors.surface, borderRadius: Radius.md, paddingHorizontal: Spacing.md,
                 paddingVertical: 12, ...Typography.bodyMd, color: Colors.onSurface },
  inputMulti:  { minHeight: 96, textAlignVertical: 'top' },
  chips:       { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8,
                 borderRadius: Radius.md, backgroundColor: Colors.surface },
  chipOn:      { backgroundColor: Colors.iconBgPurple },
  chipText:    { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextOn:  { color: Colors.primary },
  error:       { ...Typography.bodyMd, color: Colors.error },
  submit:      { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 14,
                 alignItems: 'center', marginTop: Spacing.sm },
  submitBusy:  { opacity: 0.7 },
  submitText:  { ...Typography.labelLg, color: '#FFFFFF' },
});
