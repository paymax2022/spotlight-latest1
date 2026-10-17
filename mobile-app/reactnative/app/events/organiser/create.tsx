import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Plus, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import AddressAutocompleteInput, { type SelectedAddress } from '@/components/AddressAutocompleteInput';
import { venuePatchFromSelection } from '@/features/events/venuePatch';
import { useCreateEvent, useEvent, useUpdateEvent } from '@/features/events/hooks';
import { lifecycleErrorMessage } from '@/features/events/api';
import { EventColors, EVENT_CATEGORIES } from '@/features/events/constants/events.constants';
import type { CreateEventInput, EventCategory, EventPatch } from '@/features/events/types';
import { sanitizeMoneyInput } from '@/utils/money';

const EVENTS_SOCIAL = process.env.EXPO_PUBLIC_EVENTS_SOCIAL === 'true';

// field config to a control. Adding a field/step = editing this schema only.
type FieldType = 'text' | 'multiline' | 'category';
interface FieldSchema { key: keyof FormState; label: string; placeholder?: string; type: FieldType; required?: boolean }
interface StepSchema { title: string; subtitle: string; fields: FieldSchema[] }

interface TierDraft { name: string; price: string; qty: string }
interface FormState {
  title: string; category: EventCategory; description: string;
  venue: string;
  // Set by the address picker (events-social only); null until a place is picked.
  venue_lat: number | null; venue_lng: number | null; venue_place_id: string | null;
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
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editId = typeof id === 'string' && id ? id : '';
  const isEdit = !!editId;
  const create = useCreateEvent();
  const update = useUpdateEvent(editId);
  const existing = useEvent(editId);
  const loaded = existing.data;
  // Hard-time fields lock once any ticket has sold (the backend rejects the edit).
  const timeLocked = !!loaded && loaded.tiers.some((t) => t.sold > 0);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({
    title: '', category: 'music', description: '', venue: '',
    venue_lat: null, venue_lng: null, venue_place_id: null,
    startsAtISO: new Date(Date.now() + 14 * 86400000).toISOString(),
    endsAtISO: new Date(Date.now() + 14 * 86400000 + 4 * 3600000).toISOString(),
  });
  const [tiers, setTiers] = useState<TierDraft[]>([{ name: 'Regular', price: '5000', qty: '500' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Edit mode has no tiers step (tier editing is out of scope for PATCH).
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!isEdit || !loaded || prefilled) return;
    setForm({
      title: loaded.title, category: loaded.category, description: loaded.description, venue: loaded.venue,
      venue_lat: loaded.venue_lat ?? null, venue_lng: loaded.venue_lng ?? null, venue_place_id: loaded.venue_place_id ?? null,
      startsAtISO: loaded.starts_at, endsAtISO: loaded.ends_at,
    });
    setPrefilled(true);
  }, [isEdit, loaded, prefilled]);

  const isTierStep = !isEdit && step === STEPS.length;
  const lastSchemaStep = isEdit && step === STEPS.length - 1;
  const totalSteps = isEdit ? STEPS.length : STEPS.length + 1; // schema steps (+ tiers step when creating)

  const set = (k: keyof FormState, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Typing invalidates a picked place, so the old pin is dropped with the text.
  const onVenueText = (v: string) => setForm((f) => ({ ...f, venue: v, venue_lat: null, venue_lng: null, venue_place_id: null }));
  // placeId comes from the selection's plusCode: SelectedAddress carries no provider place id.
  const onVenueSelect = (a: SelectedAddress) =>
    setForm((f) => ({ ...f, ...venuePatchFromSelection({ label: a.label, lat: a.lat, lng: a.lng, placeId: a.plusCode ?? null }) }));

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
    if (isEdit) {
      if (!lastSchemaStep) { setStep((s) => s + 1); return; }
      if (!loaded) return;
      const patch: EventPatch = {};
      if (form.title !== loaded.title) patch.title = form.title;
      if (form.description !== loaded.description) patch.description = form.description;
      if (form.venue !== loaded.venue) patch.venue = form.venue;
      if (EVENTS_SOCIAL) {
        // Only changed values are sent. Typing over a stored venue clears its
        // pin, which goes out as null so the old coordinates don't outlive the text.
        if (form.venue_lat !== (loaded.venue_lat ?? null)) patch.venue_lat = form.venue_lat;
        if (form.venue_lng !== (loaded.venue_lng ?? null)) patch.venue_lng = form.venue_lng;
        if (form.venue_place_id !== (loaded.venue_place_id ?? null)) patch.venue_place_id = form.venue_place_id;
      }
      if (form.category !== loaded.category) patch.category = form.category;
      if (!timeLocked) {
        if (form.startsAtISO !== loaded.starts_at) patch.starts_at = form.startsAtISO;
        if (form.endsAtISO !== loaded.ends_at) patch.ends_at = form.endsAtISO;
      }
      if (Object.keys(patch).length === 0) { goBack('/events/organiser/dashboard'); return; }
      try {
        await update.mutateAsync(patch);
        router.replace('/events/organiser/dashboard');
      } catch (err) {
        Alert.alert('Couldn\'t save changes', lifecycleErrorMessage(err));
      }
      return;
    }
    if (!isTierStep) { setStep((s) => s + 1); return; }
    // Submit — backend TicketTier.capacity is a required int (no "unlimited"
    // sentinel), so a blank quantity defaults to a large cap instead of null.
    const input: CreateEventInput = {
      title: form.title, category: form.category, description: form.description,
      venue: form.venue,
      // Coordinates ride along only when a place was picked; never as nulls.
      ...(EVENTS_SOCIAL && form.venue_lat !== null && form.venue_lng !== null
        ? { venue_lat: form.venue_lat, venue_lng: form.venue_lng, ...(form.venue_place_id ? { venue_place_id: form.venue_place_id } : {}) }
        : {}),
      starts_at: form.startsAtISO, ends_at: form.endsAtISO,
      tiers: tiers.map((t) => ({ name: t.name.trim(), price_kobo: Math.round(Number(t.price) * 100), capacity: t.qty ? Number(t.qty) : 100_000 })),
    };
    await create.mutateAsync(input);
    router.replace('/events/organiser/dashboard');
  };

  if (isEdit && existing.isLoading) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Edit event" /><StateView kind="loading" message="Loading event…" /></SafeAreaView>;
  }
  if (isEdit && (existing.isError || !loaded)) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Edit event" onBack={() => goBack('/events/organiser/dashboard')} /><StateView kind="error" title="Couldn't load event" message="Please try again." actionLabel="Retry" onAction={() => existing.refetch()} /></SafeAreaView>;
  }
  if (create.isPending || update.isPending) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title={isEdit ? 'Edit event' : 'Create event'} /><StateView kind="loading" message={isEdit ? 'Saving changes…' : 'Creating your event…'} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={isEdit ? 'Edit event' : 'Create event'} subtitle={`Step ${step + 1} of ${totalSteps}`} onBack={() => (step === 0 ? goBack(isEdit ? '/events/organiser/dashboard' : '/events') : setStep((s) => s - 1))} />
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
              if (EVENTS_SOCIAL && f.key === 'venue') {
                return (
                  <View key={f.key as string} style={{ marginBottom: Spacing.md }}>
                    <Text style={styles.fieldLabel}>{f.label}</Text>
                    <AddressAutocompleteInput
                      value={form.venue}
                      onChangeText={onVenueText}
                      onSelect={onVenueSelect}
                      placeholder={f.placeholder}
                      resolved={form.venue_lat !== null && form.venue_lng !== null}
                      inlineDropdown
                    />
                    {errors[f.key as string] ? <Text style={styles.fieldError}>{errors[f.key as string]}</Text> : null}
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
            {isEdit && lastSchemaStep ? (
              <>
                <TextInputField
                  label="Starts (ISO date-time)"
                  value={form.startsAtISO}
                  onChangeText={(v) => set('startsAtISO', v)}
                  editable={!timeLocked}
                  autoCapitalize="none"
                />
                <TextInputField
                  label="Ends (ISO date-time)"
                  value={form.endsAtISO}
                  onChangeText={(v) => set('endsAtISO', v)}
                  editable={!timeLocked}
                  autoCapitalize="none"
                />
                {timeLocked ? (
                  <Text style={styles.lockNote}>Start and end times are locked because tickets have already been sold.</Text>
                ) : null}
              </>
            ) : null}
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
        <PrimaryButton label={isEdit ? (lastSchemaStep ? 'Save changes' : 'Continue') : isTierStep ? 'Create event' : 'Continue'} onPress={next} />
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
  fieldError: { ...Typography.caption, color: EventColors.danger, marginTop: Spacing.xs },
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
  lockNote: { ...Typography.caption, color: EventColors.muted, marginBottom: Spacing.md },
  toggleText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
