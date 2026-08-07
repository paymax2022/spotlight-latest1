import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import { useCreateEvent } from '@/features/events/hooks';
import { EventColors, EVENT_CATEGORIES } from '@/features/events/constants/events.constants';
import type { CreateEventInput, EventCategory } from '@/features/events/types';
import { sanitizeMoneyInput } from '@/utils/money';

// Schema-driven wizard: steps are declared as data; the renderer maps each
// field config to a control. Adding a field/step = editing this schema only.
type FieldType = 'text' | 'multiline' | 'category';
interface FieldSchema { key: keyof FormState; label: string; placeholder?: string; type: FieldType; required?: boolean }
interface StepSchema { title: string; subtitle: string; fields: FieldSchema[] }

interface TierDraft { name: string; price: string; qty: string }
interface FormState {
  title: string; category: EventCategory; description: string;
  venue: string;
  startsAtISO: string; endsAtISO: string;
}

const STEPS: StepSchema[] = [
  { title: 'Basics', subtitle: 'Name and category', fields: [
    { key: 'title', label: 'Event title', placeholder: 'e.g. Lagos Tech Summit', type: 'text', required: true },
    { key: 'category', label: 'Category', type: 'category', required: true },
    { key: 'description', label: 'Description', placeholder: 'Tell attendees what to expect…', type: 'multiline', required: true },
  ] },
  { title: 'Venue', subtitle: 'Where it happens', fields: [
    { key: 'venue', label: 'Venue', placeholder: 'e.g. Landmark Centre, Victoria Island, Lagos', type: 'text', required: true },
  ] },
];

export default function CreateEvent() {
  const create = useCreateEvent();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({
    title: '', category: 'music', description: '', venue: '',
    startsAtISO: new Date(Date.now() + 14 * 86400000).toISOString(),
    endsAtISO: new Date(Date.now() + 14 * 86400000 + 4 * 3600000).toISOString(),
  });
  const [tiers, setTiers] = useState<TierDraft[]>([{ name: 'Regular', price: '5000', qty: '500' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isTierStep = step === STEPS.length;
  const totalSteps = STEPS.length + 1; // schema steps + tiers step

  const set = (k: keyof FormState, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const validateStep = (): boolean => {
    const errs: Record<string, string> = {};
    if (!isTierStep) {
      for (const f of STEPS[step].fields) {
        if (f.required && !String(form[f.key]).trim()) errs[f.key as string] = 'Required';
      }
    } else {
      tiers.forEach((t, i) => {
        if (!t.name.trim()) errs[`tier_${i}_name`] = 'Required';
        if (t.price.trim() === '' || isNaN(Number(t.price))) errs[`tier_${i}_price`] = 'Enter a number';
      });
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = async () => {
    if (!validateStep()) return;
    if (!isTierStep) { setStep((s) => s + 1); return; }
    // Submit — backend TicketTier.capacity is a required int (no "unlimited"
    // sentinel), so a blank quantity defaults to a large cap instead of null.
    const input: CreateEventInput = {
      title: form.title, category: form.category, description: form.description,
      venue: form.venue,
      starts_at: form.startsAtISO, ends_at: form.endsAtISO,
      tiers: tiers.map((t) => ({ name: t.name.trim(), price_kobo: Math.round(Number(t.price) * 100), capacity: t.qty ? Number(t.qty) : 100_000 })),
    };
    await create.mutateAsync(input);
    router.replace('/events/organiser/dashboard');
  };

  if (create.isPending) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Create event" /><StateView kind="loading" message="Creating your event…" /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create event" subtitle={`Step ${step + 1} of ${totalSteps}`} onBack={() => (step === 0 ? router.back() : setStep((s) => s - 1))} />
      <View style={styles.progress}>
        {Array.from({ length: totalSteps }).map((_, i) => (
          <View key={i} style={[styles.bar, i <= step && styles.barActive]} />
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!isTierStep ? (
          <>
            <Text style={styles.stepTitle}>{STEPS[step].title}</Text>
            <Text style={styles.stepSub}>{STEPS[step].subtitle}</Text>
            {STEPS[step].fields.map((f) => {
              if (f.type === 'category') {
                return (
                  <View key={f.key as string} style={{ marginBottom: Spacing.md }}>
                    <Text style={styles.fieldLabel}>{f.label}</Text>
                    <View style={styles.chipRow}>
                      {EVENT_CATEGORIES.filter((c) => c.value !== 'all').map((c) => {
                        const active = form.category === c.value;
                        return (
                          <Pressable key={c.value} onPress={() => set('category', c.value as EventCategory)} style={[styles.chip, active && styles.chipActive]}>
                            <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              }
              return (
                <TextInputField
                  key={f.key as string}
                  label={f.label}
                  placeholder={f.placeholder}
                  value={String(form[f.key])}
                  onChangeText={(v) => set(f.key, v)}
                  multiline={f.type === 'multiline'}
                  error={errors[f.key as string]}
                />
              );
            })}
          </>
        ) : (
          <>
            <Text style={styles.stepTitle}>Ticket tiers</Text>
            <Text style={styles.stepSub}>Add the ticket types and inventory</Text>
            {tiers.map((t, i) => (
              <View key={i} style={styles.tierCard}>
                <View style={styles.tierHead}>
                  <Text style={styles.tierIdx}>Tier {i + 1}</Text>
                  {tiers.length > 1 ? (
                    <Pressable onPress={() => setTiers((arr) => arr.filter((_, j) => j !== i))} hitSlop={8}>
                      <Trash2 size={18} color={EventColors.danger} />
                    </Pressable>
                  ) : null}
                </View>
                <TextInputField label="Name" placeholder="e.g. VIP" value={t.name} onChangeText={(v) => setTiers((a) => a.map((x, j) => j === i ? { ...x, name: v } : x))} error={errors[`tier_${i}_name`]} />
                <TextInputField label="Price (₦, 0 = free)" placeholder="5000" keyboardType="decimal-pad" inputMode="decimal" maxLength={13} value={t.price} onChangeText={(v) => setTiers((a) => a.map((x, j) => j === i ? { ...x, price: sanitizeMoneyInput(v) } : x))} error={errors[`tier_${i}_price`]} />
                <TextInputField label="Quantity (blank = 100,000)" placeholder="500" keyboardType="numeric" value={t.qty} onChangeText={(v) => setTiers((a) => a.map((x, j) => j === i ? { ...x, qty: v } : x))} />
              </View>
            ))}
            <Pressable style={styles.addTier} onPress={() => setTiers((a) => [...a, { name: '', price: '', qty: '' }])}>
              <Plus size={18} color={EventColors.brand} />
              <Text style={styles.addTierText}>Add another tier</Text>
            </Pressable>

            <Text style={styles.toggleText}>A closed-loop cashless event wallet is available to every attendee automatically.</Text>
          </>
        )}
        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={isTierStep ? 'Create event' : 'Continue'} onPress={next} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  progress: { flexDirection: 'row', gap: 6, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.md },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh },
  barActive: { backgroundColor: EventColors.brand },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xs },
  stepTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  stepSub: { ...Typography.bodyMd, color: EventColors.muted, marginBottom: Spacing.lg },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  chipActive: { backgroundColor: EventColors.brand, borderColor: EventColors.brand },
  chipText: { ...Typography.labelSm, color: EventColors.muted },
  chipTextActive: { color: Colors.onPrimary },
  tierCard: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  tierHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  tierIdx: { ...Typography.labelLg, color: Colors.onSurface },
  addTier: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.outlineVariant },
  addTierText: { ...Typography.labelMd, color: EventColors.brand },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.lg },
  checkbox: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: EventColors.brand, borderColor: EventColors.brand },
  toggleText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
