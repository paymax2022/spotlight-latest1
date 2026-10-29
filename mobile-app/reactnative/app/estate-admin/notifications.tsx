import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Switch, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { confirmAsync } from '@/lib/confirm';
import { useRetentionPolicy, useRunNotificationRetention, useSetRetentionPolicy } from '@/features/notifications/hooks';
import { PROTECTABLE_CATEGORIES } from '@/features/notifications/api';
import type { RetentionPolicy, RetentionPolicyPatch } from '@/features/notifications/api';

// Estate notification retention plane (estate-d EST-UAT-0359, Phase 2.5a). Estate admin only: the routes
// behind this answer 403 for a member, and the sweep itself runs in the database, so this screen reports
// and schedules — it never deletes a notice by hand.
type FormState = { enabled: boolean; archiveDays: number; purgeDays: number | null; keep: string[] };

const toForm = (p: RetentionPolicy): FormState => ({
  enabled: p.enabled,
  archiveDays: p.archive_after_days,
  purgeDays: p.purge_after_days,
  keep: [...p.keep_categories],
});

function diff(p: RetentionPolicy, f: FormState): RetentionPolicyPatch | null {
  const patch: RetentionPolicyPatch = {};
  if (f.enabled !== p.enabled) patch.enabled = f.enabled;
  if (f.archiveDays !== p.archive_after_days) patch.archive_after_days = f.archiveDays;
  if (f.purgeDays !== p.purge_after_days) patch.purge_after_days = f.purgeDays;
  const same = f.keep.length === p.keep_categories.length && f.keep.every((c) => p.keep_categories.includes(c));
  if (!same) patch.keep_categories = f.keep;
  return Object.keys(patch).length ? patch : null;
}

export default function AdminNotificationRetentionScreen() {
  const { data, isLoading, isError, refetch } = useRetentionPolicy();
  const save = useSetRetentionPolicy();
  const run = useRunNotificationRetention();

  const [form, setForm] = useState<FormState | null>(null);
  useEffect(() => { if (data) setForm(toForm(data)); }, [data]);

  const patch = useMemo(() => (data && form ? diff(data, form) : null), [data, form]);
  const invalid = !!form && (form.archiveDays < 1
    || (form.purgeDays !== null && (form.purgeDays < 1 || form.purgeDays < form.archiveDays)));

  if (isLoading) {
    return <Shell><StateView kind="loading" message="Loading policy…" /></Shell>;
  }
  if (isError || !data || !form) {
    return (
      <Shell>
        <StateView kind="error" title="Couldn't load" message="Retention settings are for estate admins." actionLabel="Retry" onAction={() => refetch()} />
      </Shell>
    );
  }

  const onSave = () => { if (patch) save.mutate(patch, { onSuccess: () => refetch() }); };

  const onRun = async () => {
    const purge = data.purge_after_days;
    const ok = await confirmAsync({
      title: 'Run the schedule now?',
      message: purge
        ? `Read, unpinned notices older than ${data.archive_after_days} days are archived, and those past ${purge} days are removed permanently. Pinned notices and protected categories are never swept.`
        : `Read, unpinned notices older than ${data.archive_after_days} days are archived. Nothing is deleted — this estate has not opted into purging.`,
      confirmLabel: 'Run',
    });
    if (ok) run.mutate();
  };

  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {data.defaulted ? (
          <Text style={styles.note}>These are the module defaults — this estate has never set a policy. Saving writes one.</Text>
        ) : null}

        <View style={styles.card}>
          <Row label="Retention active" hint="When off, the schedule archives and purges nothing." border={false}>
            <Switch value={form.enabled} onValueChange={(v) => setForm({ ...form, enabled: v })} trackColor={{ true: Colors.primary, false: Colors.surfaceContainerLow }} />
          </Row>
          <Row label="Archive after (days)" hint="Reversible: a read, unpinned notice outside the protected categories moves to the archive half of the inbox." border>
            <Numeric value={form.archiveDays} onChange={(v) => setForm({ ...form, archiveDays: v ?? 0 })} />
          </Row>
          <Row label="Purge after (days)" hint="Empty means never purge. Past this age an archived notice is gone for good, which is why purging has to be opted into." border>
            <Numeric value={form.purgeDays} nullable onChange={(v) => setForm({ ...form, purgeDays: v })} />
          </Row>
        </View>

        <Text style={styles.section}>Never archive these categories</Text>
        <View style={styles.chips}>
          {PROTECTABLE_CATEGORIES.map((c) => {
            const on = form.keep.includes(c);
            return (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setForm({ ...form, keep: on ? form.keep.filter((x) => x !== c) : [...form.keep, c] })}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.note}>This list replaces what is stored, so un-selecting a category and saving makes its notices sweepable again.</Text>

        {!data.defaulted && data.updated_at ? (
          <Text style={styles.note}>Last changed {new Date(data.updated_at).toLocaleString()} by {data.updated_by ?? 'an estate admin'}.</Text>
        ) : null}

        {invalid ? <Text style={styles.error}>Both ages must be positive, and purge cannot be scheduled before archive.</Text> : null}
        {save.isError ? <Text style={styles.error}>{String((save.error as any)?.message ?? 'Could not save the policy.')}</Text> : null}

        {run.data ? (
          <View style={styles.result}>
            <Text style={styles.resultTitle}>Last run</Text>
            <Text style={styles.resultText}>{`${run.data.notifications_archived} archived · ${run.data.notifications_purged} purged`}</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={!patch || invalid || save.isPending}
          onPress={onSave}
          style={({ pressed }) => [styles.primary, (!patch || invalid || save.isPending) && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.primaryText}>{save.isPending ? 'Saving…' : 'Save policy'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={run.isPending} onPress={onRun} style={({ pressed }) => [styles.secondary, run.isPending && styles.disabled, pressed && styles.pressed]}>
          <Text style={styles.secondaryText}>{run.isPending ? 'Running…' : 'Run the schedule now'}</Text>
        </Pressable>
      </ScrollView>
    </Shell>
  );
}

function Row({ label, hint, children, border }: { label: string; hint: string; children: React.ReactNode; border?: boolean }) {
  return (
    <View style={[styles.row, border && styles.rowBorder]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      {children}
    </View>
  );
}

function Numeric({ value, onChange, nullable }: { value: number | null; onChange: (v: number | null) => void; nullable?: boolean }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => { setText(value === null ? '' : String(value)); }, [value]);
  return (
    <TextInput
      value={text}
      onChangeText={(t) => {
        setText(t);
        const trimmed = t.trim();
        if (trimmed === '') return onChange(nullable ? null : 0);
        const n = Number(trimmed);
        onChange(Number.isFinite(n) ? Math.floor(n) : 0);
      }}
      keyboardType="numeric"
      placeholder={nullable ? 'never' : ''}
      placeholderTextColor={Colors.outline}
      accessibilityLabel={nullable ? 'Purge after days' : 'Archive after days'}
      style={styles.input}
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Retention" subtitle="Notification archive" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  note: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  section: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, ...shadow1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
  rowLabel: { ...Typography.labelLg, color: Colors.onSurface },
  rowHint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  input: { minWidth: 74, textAlign: 'center', borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceContainerLow, paddingVertical: 6, paddingHorizontal: Spacing.sm, ...Typography.bodyMd, color: Colors.onSurface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
  chipOn: { backgroundColor: Colors.iconBgPurple, borderColor: Colors.primary },
  chipText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textTransform: 'capitalize' },
  chipTextOn: { color: Colors.primary, fontWeight: '700' },
  error: { ...Typography.labelSm, color: Colors.error },
  result: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, gap: 2 },
  resultTitle: { ...Typography.labelMd, color: Colors.onSurface },
  resultText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  primary: { marginTop: Spacing.md, borderRadius: Radius.full, paddingVertical: Spacing.md, alignItems: 'center', backgroundColor: Colors.primary },
  primaryText: { ...Typography.labelLg, color: Colors.onPrimary, fontWeight: '700' },
  secondary: { borderRadius: Radius.full, paddingVertical: Spacing.md, alignItems: 'center', backgroundColor: Colors.surfaceContainerLow },
  secondaryText: { ...Typography.labelLg, color: Colors.primary, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
