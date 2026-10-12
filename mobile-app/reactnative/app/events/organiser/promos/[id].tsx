import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { confirmAsync } from '@/lib/confirm';
import { Plus, Pencil } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import { useEvent, useCreatePromo, useUpdatePromo } from '@/features/events/hooks';
import { lifecycleErrorMessage } from '@/features/events/api';
import { EventColors, EVENTS_TICKETING_DEPTH_ENABLED, formatNaira } from '@/features/events/constants/events.constants';
import type { PromoCode, PromoPatch, CreatePromoInput } from '@/features/events/types';
import { sanitizeMoneyInput } from '@/utils/money';

const BACK = '/events/organiser/dashboard';
type Mode = 'percent' | 'amount';

interface Draft {
  code: string; mode: Mode; percent: string; amount: string; tierId: string;
  startsAt: string; endsAt: string; maxUses: string; perUser: string; active: boolean;
}
const EMPTY: Draft = { code: '', mode: 'percent', percent: '', amount: '', tierId: '', startsAt: '', endsAt: '', maxUses: '', perUser: '', active: true };

const toDraft = (p: PromoCode): Draft => ({
  code: p.code,
  mode: (p.amount_off_kobo ?? 0) > 0 ? 'amount' : 'percent',
  percent: p.percent_off ? String(p.percent_off) : '',
  amount: p.amount_off_kobo ? String(p.amount_off_kobo / 100) : '',
  tierId: p.tier_id ?? '', startsAt: p.starts_at ?? '', endsAt: p.ends_at ?? '',
  maxUses: String(p.max_uses ?? 0), perUser: String(p.per_user_limit ?? 0), active: p.active,
});

const validIso = (v: string) => v.trim() === '' || !isNaN(Date.parse(v.trim()));
const describe = (p: PromoCode) => (p.amount_off_kobo ?? 0) > 0 ? `${formatNaira(p.amount_off_kobo as number)} off` : `${p.percent_off}% off`;

export default function ManagePromos() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const eventId = typeof id === 'string' ? id : '';
  const event = useEvent(eventId);
  const createPromo = useCreatePromo(eventId);
  const updatePromo = useUpdatePromo(eventId);
  // The backend exposes no organiser list-promos route yet, so this list holds
  // promos created or edited in this session only.
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [editing, setEditing] = useState<string | null>(null); // null | 'new' | promo id
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const tiers = event.data?.tiers ?? [];
  const current = editing && editing !== 'new' ? promos.find((p) => p.id === editing) : undefined;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  if (!EVENTS_TICKETING_DEPTH_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Promo codes" onBack={() => goBack(BACK)} />
        <StateView kind="empty" title="Not available yet" message="Promo code management isn't enabled for your account." />
      </SafeAreaView>
    );
  }
  if (event.isLoading) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Promo codes" /><StateView kind="loading" message="Loading…" /></SafeAreaView>;
  }
  if (event.isError || !event.data) {
    return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Promo codes" onBack={() => goBack(BACK)} /><StateView kind="error" title="Couldn't load event" message="Please try again." actionLabel="Retry" onAction={() => event.refetch()} /></SafeAreaView>;
  }

  const open = (p?: PromoCode) => { setErrors({}); setDraft(p ? toDraft(p) : EMPTY); setEditing(p ? p.id : 'new'); };
  const close = () => { setEditing(null); setErrors({}); };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (editing === 'new' && !draft.code.trim()) e.code = 'Required';
    if (draft.mode === 'percent') {
      const n = Number(draft.percent);
      if (draft.percent.trim() === '' || !Number.isInteger(n) || n < 1 || n > 100) e.percent = 'Enter a whole number from 1 to 100';
    } else {
      const n = Number(draft.amount);
      if (draft.amount.trim() === '' || isNaN(n) || n <= 0) e.amount = 'Enter an amount above 0';
    }
    for (const [k, v] of [['maxUses', draft.maxUses], ['perUser', draft.perUser]] as const) {
      if (v.trim() !== '' && !/^\d+$/.test(v.trim())) e[k] = 'Enter a whole number (0 = unlimited)';
    }
    if (!validIso(draft.startsAt)) e.startsAt = 'Use an ISO date-time, e.g. 2026-11-01T09:00:00Z';
    if (!validIso(draft.endsAt)) e.endsAt = 'Use an ISO date-time, e.g. 2026-11-01T09:00:00Z';
    if (!e.startsAt && !e.endsAt && draft.startsAt.trim() && draft.endsAt.trim() && Date.parse(draft.endsAt) <= Date.parse(draft.startsAt)) e.endsAt = 'Must be after the start';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const upsert = (p: PromoCode) => setPromos((arr) => (arr.some((x) => x.id === p.id) ? arr.map((x) => (x.id === p.id ? p : x)) : [p, ...arr]));

  const save = async () => {
    if (!validate()) return;
    const kobo = Math.round(Number(draft.amount) * 100);
    const pct = Number(draft.percent);
    try {
      if (editing === 'new') {
        // Exactly one discount kind — the server rejects both or neither.
        const input: CreatePromoInput = { code: draft.code.trim(), ...(draft.mode === 'percent' ? { percent_off: pct } : { amount_off_kobo: kobo }) };
        if (draft.tierId) input.tier_id = draft.tierId;
        if (draft.startsAt.trim()) input.starts_at = draft.startsAt.trim();
        if (draft.endsAt.trim()) input.ends_at = draft.endsAt.trim();
        if (draft.maxUses.trim()) input.max_uses = Number(draft.maxUses);
        if (draft.perUser.trim()) input.per_user_limit = Number(draft.perUser);
        upsert(await createPromo.mutateAsync(input));
      } else if (current) {
        // Code is never sent: the server rejects code edits. When switching
        // discount kind, zero the previous kind so exactly one stays non-zero.
        const patch: PromoPatch = {};
        if (draft.mode === 'percent') {
          patch.percent_off = pct;
          if ((current.amount_off_kobo ?? 0) > 0) patch.amount_off_kobo = 0;
        } else {
          patch.amount_off_kobo = kobo;
          if (current.percent_off > 0) patch.percent_off = 0;
        }
        patch.tier_id = draft.tierId || null;
        patch.starts_at = draft.startsAt.trim() || null;
        patch.ends_at = draft.endsAt.trim() || null;
        if (draft.maxUses.trim()) patch.max_uses = Number(draft.maxUses);
        if (draft.perUser.trim()) patch.per_user_limit = Number(draft.perUser);
        patch.active = draft.active;
        upsert(await updatePromo.mutateAsync({ promoId: current.id, patch }));
      }
      close();
    } catch (err) {
      Alert.alert('Couldn\'t save promo', lifecycleErrorMessage(err));
    }
  };

  const deactivate = async (p: PromoCode) => {
    const ok = await confirmAsync({ title: 'Deactivate promo?', message: `${p.code} will stop working for new purchases.`, confirmLabel: 'Deactivate', cancelLabel: 'Keep active', destructive: true });
    if (!ok) return;
    try { upsert(await updatePromo.mutateAsync({ promoId: p.id, patch: { active: false } })); close(); }
    catch (err) { Alert.alert('Couldn\'t deactivate promo', lifecycleErrorMessage(err)); }
  };

  const saving = createPromo.isPending || updatePromo.isPending;

  if (editing) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={editing === 'new' ? 'New promo' : 'Edit promo'} onBack={close} />
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TextInputField label="Code" autoCapitalize="characters" value={draft.code} onChangeText={(v) => set('code', v)} editable={editing === 'new'} error={errors.code} />
          {editing !== 'new' ? <Text style={styles.note}>The code can&apos;t be changed after creation. Create a new promo for a different code.</Text> : null}
          <Text style={styles.fieldLabel}>Discount type</Text>
          <View style={styles.chipRow}>
            {(['percent', 'amount'] as Mode[]).map((m) => (
              <Pressable key={m} onPress={() => set('mode', m)} style={[styles.chip, draft.mode === m && styles.chipActive]}>
                <Text style={[styles.chipText, draft.mode === m && styles.chipTextActive]}>{m === 'percent' ? 'Percent off' : 'Fixed amount'}</Text>
              </Pressable>
            ))}
          </View>
          {draft.mode === 'percent' ? (
            <TextInputField label="Percent off (1-100)" keyboardType="numeric" value={draft.percent} onChangeText={(v) => set('percent', v.replace(/[^\d]/g, ''))} error={errors.percent} />
          ) : (
            <TextInputField label="Amount off (₦)" keyboardType="decimal-pad" inputMode="decimal" maxLength={13} value={draft.amount} onChangeText={(v) => set('amount', sanitizeMoneyInput(v))} error={errors.amount} />
          )}
          <Text style={styles.fieldLabel}>Applies to</Text>
          <View style={styles.chipRow}>
            <Pressable onPress={() => set('tierId', '')} style={[styles.chip, !draft.tierId && styles.chipActive]}>
              <Text style={[styles.chipText, !draft.tierId && styles.chipTextActive]}>All tiers</Text>
            </Pressable>
            {tiers.map((t) => (
              <Pressable key={t.id} onPress={() => set('tierId', t.id)} style={[styles.chip, draft.tierId === t.id && styles.chipActive]}>
                <Text style={[styles.chipText, draft.tierId === t.id && styles.chipTextActive]}>{t.name}</Text>
              </Pressable>
            ))}
          </View>
          <TextInputField label="Valid from (ISO date-time, optional)" autoCapitalize="none" value={draft.startsAt} onChangeText={(v) => set('startsAt', v)} error={errors.startsAt} />
          <TextInputField label="Valid until (ISO date-time, optional)" autoCapitalize="none" value={draft.endsAt} onChangeText={(v) => set('endsAt', v)} error={errors.endsAt} />
          <TextInputField label="Max total uses (0 = unlimited)" keyboardType="numeric" value={draft.maxUses} onChangeText={(v) => set('maxUses', v.replace(/[^\d]/g, ''))} error={errors.maxUses} />
          <TextInputField label="Max uses per person (0 = unlimited)" keyboardType="numeric" value={draft.perUser} onChangeText={(v) => set('perUser', v.replace(/[^\d]/g, ''))} error={errors.perUser} />
          {editing !== 'new' ? (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Active</Text>
              <Switch value={draft.active} onValueChange={(v) => set('active', v)} />
            </View>
          ) : null}
          {current && current.active ? (
            <Pressable onPress={() => deactivate(current)} style={styles.dangerBtn} accessibilityRole="button">
              <Text style={styles.dangerText}>Deactivate promo</Text>
            </Pressable>
          ) : null}
          <View style={{ height: 120 }} />
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label={saving ? 'Saving…' : editing === 'new' ? 'Create promo' : 'Save changes'} onPress={save} disabled={saving} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Promo codes" subtitle={event.data.title} onBack={() => goBack(BACK)} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.note}>Promos created or edited in this session appear below.</Text>
        {promos.map((p) => (
          <Pressable key={p.id} style={styles.card} onPress={() => open(p)} accessibilityRole="button" accessibilityLabel={`Edit ${p.code}`}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{p.code}</Text>
              <Pencil size={16} color={EventColors.brand} />
            </View>
            <Text style={styles.meta}>{describe(p)} · {p.active ? 'Active' : 'Inactive'}</Text>
          </Pressable>
        ))}
        <Pressable style={styles.addBtn} onPress={() => open()}>
          <Plus size={18} color={EventColors.brand} />
          <Text style={styles.addText}>Add promo</Text>
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
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.outlineVariant },
  chipActive: { backgroundColor: EventColors.brand, borderColor: EventColors.brand },
  chipText: { ...Typography.labelSm, color: EventColors.muted },
  chipTextActive: { color: Colors.onPrimary },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.outlineVariant },
  addText: { ...Typography.labelMd, color: EventColors.brand },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  switchLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  dangerBtn: { alignItems: 'center', paddingVertical: Spacing.md },
  dangerText: { ...Typography.labelMd, color: EventColors.danger },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
