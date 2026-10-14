import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { Plus, Pencil } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import { useEvent, useAddTier, useUpdateTier } from '@/features/events/hooks';
import { lifecycleErrorMessage } from '@/features/events/api';
import { EventColors, EVENTS_TICKETING_DEPTH_ENABLED, USE_MOCK, formatNaira } from '@/features/events/constants/events.constants';
import type { TicketTier, TierPatch, AddTierInput } from '@/features/events/types';
import { sanitizeMoneyInput } from '@/utils/money';

const BACK = '/events/organiser/dashboard';

interface Draft {
  name: string; description: string; price: string; capacity: string;
  active: boolean; inviteOnly: boolean; salesStart: string; salesEnd: string;
}
const EMPTY: Draft = { name: '', description: '', price: '', capacity: '', active: true, inviteOnly: false, salesStart: '', salesEnd: '' };

const toDraft = (t: TicketTier): Draft => ({
  name: t.name, description: '', price: String(t.price_kobo / 100), capacity: String(t.capacity),
  active: t.active, inviteOnly: !!t.invite_only, salesStart: t.sales_start_at ?? '', salesEnd: t.sales_end_at ?? '',
});

const validIso = (v: string) => v.trim() === '' || !isNaN(Date.parse(v.trim()));

export default function ManageTiers() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const eventId = typeof id === 'string' ? id : '';
  const event = useEvent(eventId);
  const addTier = useAddTier(eventId);
  const updateTier = useUpdateTier(eventId);
  // null = list view, 'new' = create form, otherwise the tier id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const tiers = event.data?.tiers ?? [];
  const current = editing && editing !== 'new' ? tiers.find((t) => t.id === editing) : undefined;
  const priceLocked = !!current && current.sold > 0;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  if (!EVENTS_TICKETING_DEPTH_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Ticket tiers" onBack={() => goBack(BACK)} />
        <StateView kind="empty" title="Not available yet" message="Advanced ticket tier management isn't enabled for your account." />
      </SafeAreaView>
    );
  }
  if (event.isLoading) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Ticket tiers" /><StateView kind="loading" message="Loading tiers…" /></SafeAreaView>;
  }
  if (event.isError || !event.data) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Ticket tiers" onBack={() => goBack(BACK)} /><StateView kind="error" title="Couldn't load event" message="Please try again." actionLabel="Retry" onAction={() => event.refetch()} /></SafeAreaView>;
  }

  const open = (t?: TicketTier) => { setErrors({}); setDraft(t ? toDraft(t) : EMPTY); setEditing(t ? t.id : 'new'); };
  const close = () => { setEditing(null); setErrors({}); };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!draft.name.trim()) e.name = 'Required';
    if (!priceLocked && (draft.price.trim() === '' || isNaN(Number(draft.price)))) e.price = 'Enter a number';
    const cap = Number(draft.capacity);
    if (draft.capacity.trim() === '' || !Number.isInteger(cap) || cap < 0) e.capacity = 'Enter a whole number';
    else if (current && cap < current.sold) e.capacity = `Can't be below tickets already sold (${current.sold})`;
    if (!validIso(draft.salesStart)) e.salesStart = 'Use an ISO date-time, e.g. 2026-11-01T09:00:00Z';
    if (!validIso(draft.salesEnd)) e.salesEnd = 'Use an ISO date-time, e.g. 2026-11-01T09:00:00Z';
    if (!e.salesStart && !e.salesEnd && draft.salesStart.trim() && draft.salesEnd.trim()
      && Date.parse(draft.salesEnd) <= Date.parse(draft.salesStart)) e.salesEnd = 'Must be after the sales start';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    const start = draft.salesStart.trim() ? draft.salesStart.trim() : null;
    const end = draft.salesEnd.trim() ? draft.salesEnd.trim() : null;
    try {
      if (editing === 'new') {
        // addTicketTier has a fixture fallback that would fake success; refuse instead.
        if (USE_MOCK) throw new Error('Creating a ticket tier is unavailable in fixture mode');
        const input: AddTierInput = {
          name: draft.name.trim(), price_kobo: Math.round(Number(draft.price) * 100), capacity: Number(draft.capacity),
          invite_only: draft.inviteOnly, sales_start_at: start, sales_end_at: end,
        };
        if (draft.description.trim()) input.description = draft.description.trim();
        await addTier.mutateAsync(input);
      } else if (current) {
        const patch: TierPatch = {};
        if (draft.name.trim() !== current.name) patch.name = draft.name.trim();
        if (draft.description.trim()) patch.description = draft.description.trim();
        if (!priceLocked && Math.round(Number(draft.price) * 100) !== current.price_kobo) patch.price_kobo = Math.round(Number(draft.price) * 100);
        if (Number(draft.capacity) !== current.capacity) patch.capacity = Number(draft.capacity);
        if (draft.active !== current.active) patch.active = draft.active;
        if (draft.inviteOnly !== !!current.invite_only) patch.invite_only = draft.inviteOnly;
        if (start !== (current.sales_start_at ?? null)) patch.sales_start_at = start;
        if (end !== (current.sales_end_at ?? null)) patch.sales_end_at = end;
        if (Object.keys(patch).length === 0) { close(); return; }
        await updateTier.mutateAsync({ tierId: current.id, patch });
      }
      close();
    } catch (err) {
      Alert.alert('Couldn\'t save tier', lifecycleErrorMessage(err));
    }
  };

  const saving = addTier.isPending || updateTier.isPending;

  if (editing) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={editing === 'new' ? 'New tier' : 'Edit tier'} onBack={close} />
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TextInputField label="Name" value={draft.name} onChangeText={(v) => set('name', v)} error={errors.name} />
          <TextInputField label="Description (optional)" value={draft.description} onChangeText={(v) => set('description', v)} multiline />
          <TextInputField
            label="Price (₦, 0 = free)" keyboardType="decimal-pad" inputMode="decimal" maxLength={13}
            value={draft.price} onChangeText={(v) => set('price', sanitizeMoneyInput(v))}
            editable={!priceLocked} error={errors.price}
          />
          {priceLocked ? <Text style={styles.note}>Price is locked because {current!.sold} ticket{current!.sold === 1 ? ' has' : 's have'} already been sold.</Text> : null}
          <TextInputField label="Capacity" keyboardType="numeric" value={draft.capacity} onChangeText={(v) => set('capacity', v.replace(/[^\d]/g, ''))} error={errors.capacity} />
          <TextInputField label="Sales start (ISO date-time, blank = now)" autoCapitalize="none" value={draft.salesStart} onChangeText={(v) => set('salesStart', v)} error={errors.salesStart} />
          <TextInputField label="Sales end (ISO date-time, blank = no end)" autoCapitalize="none" value={draft.salesEnd} onChangeText={(v) => set('salesEnd', v)} error={errors.salesEnd} />
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Invite only (not purchasable by the public)</Text>
            <Switch value={draft.inviteOnly} onValueChange={(v) => set('inviteOnly', v)} />
          </View>
          {editing !== 'new' ? (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Active</Text>
              <Switch value={draft.active} onValueChange={(v) => set('active', v)} />
            </View>
          ) : null}
          <View style={{ height: 120 }} />
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label={saving ? 'Saving…' : editing === 'new' ? 'Create tier' : 'Save changes'} onPress={save} disabled={saving} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Ticket tiers" subtitle={event.data.title} onBack={() => goBack(BACK)} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {tiers.length === 0 ? <Text style={styles.note}>No tiers yet.</Text> : null}
        {tiers.map((t) => (
          <Pressable key={t.id} style={styles.card} onPress={() => open(t)} accessibilityRole="button" accessibilityLabel={`Edit ${t.name}`}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{t.name}</Text>
              <Pencil size={16} color={EventColors.brand} />
            </View>
            <Text style={styles.meta}>{t.price_kobo === 0 ? 'Free' : formatNaira(t.price_kobo)} · {t.sold}/{t.capacity} sold</Text>
            <Text style={styles.meta}>
              {t.active ? 'Active' : 'Inactive'}{t.invite_only ? ' · Invite only' : ''}
              {t.sales_start_at ? ` · From ${t.sales_start_at}` : ''}{t.sales_end_at ? ` · Until ${t.sales_end_at}` : ''}
            </Text>
          </Pressable>
        ))}
        <Pressable style={styles.addBtn} onPress={() => open()}>
          <Plus size={18} color={EventColors.brand} />
          <Text style={styles.addText}>Add tier</Text>
        </Pressable>
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  card: { backgroundColor: EventColors.surface, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.bodyMd, color: EventColors.muted, marginTop: 2 },
  note: { ...Typography.caption, color: EventColors.muted, marginBottom: Spacing.md },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.outlineVariant },
  addText: { ...Typography.labelMd, color: EventColors.brand },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.md },
  switchLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
