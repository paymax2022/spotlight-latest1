import React, { useMemo, useState } from 'react';
import { View, Text, Switch, Pressable, StyleSheet } from 'react-native';
import { Copy } from 'lucide-react-native';
import { Colors, Radius, Spacing } from '@/constants/tokens';
import PrimaryButton from '@/components/PrimaryButton';
import TimePickerField from '@/components/TimePickerField';
import { useBusinessHours, useSetBusinessHours } from './hooks';
import {
  WEEKDAY_LABELS, copyToAll, summarizeWeek, validateWeek, weekFromWindows, windowsFromWeek,
  type DayRow,
} from './hours';

/**
 * The outlet's trading hours: which days it opens, and the window on each of them.
 *
 * Two things the owner needs to know up front, because they are what makes this
 * different from a note on the door: the schedule BLOCKS immediate orders outside the
 * window (a customer who taps "order now" at 23:00 is refused and told when it opens
 * again), and a scheduled order for a later time is still accepted. A week with no days
 * switched on has no schedule at all — that outlet stays governed by its open/closed
 * switch alone, exactly as it was before hours existed.
 */
export default function TradingHoursEditor({ storeId }: { storeId: string }) {
  const hours = useBusinessHours(storeId);
  const save = useSetBusinessHours(storeId);
  // null until the owner edits, so the rows keep tracking the server until then.
  const [rows, setRows] = useState<DayRow[] | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const server = hours.data;
  const shown = rows ?? (server ? weekFromWindows(server.windows) : null);
  const dirty = useMemo(() => {
    if (!rows || !server) return false;
    const a = JSON.stringify(windowsFromWeek(rows).map((w) => [w.dayOfWeek, w.open, w.close]).sort());
    const b = JSON.stringify(server.windows.map((w) => [w.dayOfWeek, w.open, w.close]).sort());
    return a !== b;
  }, [rows, server]);

  if (hours.isLoading) return <View style={styles.card}><Text style={styles.muted}>Loading your hours…</Text></View>;
  if (hours.isError || !server) {
    return (
      <View style={styles.card}>
        <Text style={styles.muted}>Couldn’t load your opening hours.</Text>
        <Pressable onPress={() => hours.refetch()} accessibilityRole="button">
          <Text style={styles.link}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const problem = shown ? validateWeek(shown) : null;
  const canSave = Boolean(shown) && dirty && !problem && !save.isPending;

  const submit = () => {
    if (!shown) return;
    const invalid = validateWeek(shown);
    if (invalid) { setSavedNote(null); return; }
    save.mutate(windowsFromWeek(shown), {
      onSuccess: () => { setRows(null); setSavedNote('Opening hours saved.'); },
      onError: (e) => setSavedNote(`Couldn’t save: ${(e as Error).message}`),
    });
  };

  const clearNote = () => { if (savedNote) setSavedNote(null); };

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.summary}>{summarizeWeek(shown ?? [])}</Text>
          <Text style={styles.muted}>
            {server.openNow ? 'Taking immediate orders now.' : 'Not taking immediate orders right now — scheduled orders still come in.'}
          </Text>
        </View>
        <View style={[styles.badge, server.openNow ? styles.badgeOn : styles.badgeOff]}>
          <Text style={styles.badgeText}>{server.openNow ? 'Open' : 'Closed'}</Text>
        </View>
      </View>

      {shown?.map((row) => (
        <View key={row.dayOfWeek} style={styles.dayRow}>
          <View style={styles.dayHead}>
            <Switch
              value={row.open}
              onValueChange={(open) => { clearNote(); setRows(shown.map((r) => (r.dayOfWeek === row.dayOfWeek ? { ...r, open } : r))); }}
              accessibilityLabel={`${WEEKDAY_LABELS[row.dayOfWeek]} open`}
              trackColor={{ true: Colors.primary, false: Colors.outlineVariant }}
            />
            <Text style={[styles.dayLabel, row.open && styles.dayLabelOn]}>{WEEKDAY_LABELS[row.dayOfWeek]}</Text>
            <View style={{ flex: 1 }} />
            {row.open ? (
              <Pressable
                onPress={() => { clearNote(); setRows(copyToAll(shown, row.dayOfWeek)); }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Use these ${WEEKDAY_LABELS[row.dayOfWeek]} hours for every day`}
              >
                <View style={styles.copyRow}>
                  <Copy size={14} color={Colors.primary} strokeWidth={2.2} />
                  <Text style={styles.copyText}>All week</Text>
                </View>
              </Pressable>
            ) : (
              <Text style={styles.closed}>Closed</Text>
            )}
          </View>

          {row.open ? (
            <View style={styles.timesRow}>
              <View style={{ flex: 1 }}>
                <TimePickerField
                  label="Opens"
                  value={row.from}
                  onChange={(from) => { clearNote(); setRows(shown.map((r) => (r.dayOfWeek === row.dayOfWeek ? { ...r, from } : r))); }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TimePickerField
                  label="Closes"
                  value={row.to}
                  onChange={(to) => { clearNote(); setRows(shown.map((r) => (r.dayOfWeek === row.dayOfWeek ? { ...r, to } : r))); }}
                />
              </View>
            </View>
          ) : null}
        </View>
      ))}

      <Text style={styles.muted}>
        A closing time earlier than the opening time means the day runs past midnight — 20:00 to
        02:00 stays open into the next morning.
      </Text>
      {problem ? <Text style={styles.error} accessibilityRole="alert">{problem}</Text> : null}
      {savedNote && !problem ? <Text style={styles.muted}>{savedNote}</Text> : null}

      <PrimaryButton label="Save opening hours" onPress={submit} loading={save.isPending} disabled={!canSave} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    gap: Spacing.sm, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  summary: { color: Colors.onSurface, fontSize: 14, fontWeight: '600' },
  muted: { color: Colors.onSurfaceVariant, fontSize: 12 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  badgeOn: { backgroundColor: Colors.primaryContainer },
  badgeOff: { backgroundColor: Colors.surfaceContainerHigh },
  badgeText: { color: Colors.onPrimaryContainer, fontSize: 12, fontWeight: '700' },
  dayRow: { gap: 2, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dayLabel: { color: Colors.onSurfaceVariant, fontSize: 14, fontWeight: '600' },
  dayLabelOn: { color: Colors.onSurface },
  closed: { color: Colors.onSurfaceVariant, fontSize: 12 },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  copyText: { color: Colors.primary, fontSize: 12, fontWeight: '700' },
  timesRow: { flexDirection: 'row', gap: Spacing.sm },
  error: { color: Colors.error, fontSize: 13 },
  link: { color: Colors.primary, fontSize: 13, fontWeight: '700' },
});
