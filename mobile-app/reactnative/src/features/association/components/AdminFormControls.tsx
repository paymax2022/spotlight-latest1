// ── Association — Shared controls for the admin authoring forms ───────────────
//
// Five content types share one editing vocabulary (a card, a chip row, a
// switch, a string-list editor, a date+time field). Building them once here
// keeps the five form screens to their own fields and validation rather than
// re-implementing the same layout five times with five slightly different
// paddings.

import React, { useMemo, useState } from 'react';
import { View, Text, Switch, Pressable, StyleSheet } from 'react-native';
import { Plus, X, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import DatePickerField from '@/components/DatePickerField';
import { parseDateSafe } from '../utils/associationFormatters';

// ─── Layout ───────────────────────────────────────────────────────────────────

export function FormCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={[styles.card, shadow1]}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

/** Inline validation / warning strip. */
export function FormNotice({ tone = 'warn', text }: { tone?: 'warn' | 'error' | 'info'; text: string }) {
  const color = tone === 'error' ? Colors.error : tone === 'info' ? Colors.secondary : Colors.onWarning;
  const bg = tone === 'error' ? Colors.errorContainer : tone === 'info' ? Colors.iconBgBlue : Colors.iconBgGold;
  return (
    <View style={[styles.notice, { backgroundColor: bg }]}>
      <AlertTriangle size={14} color={color} strokeWidth={2.2} />
      <Text style={[styles.noticeText, { color }]}>{text}</Text>
    </View>
  );
}

// ─── Controls ─────────────────────────────────────────────────────────────────

export interface Option<T extends string> { value: T; label: string }

/** Chip row for short enum choices (mode, state, priority…). */
export function ChoiceRow<T extends string>({
  label, options, value, onChange,
}: { label: string; options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${o.label}`}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Dropdown for longer id-keyed lists (chapters, categories, committees,
 * assignees). Wraps the shared SelectField, which speaks plain strings, and
 * maps the chosen label back to its id so the caller only ever sees ids.
 */
export function OptionSelect<T extends string>({
  label, placeholder, options, value, onChange, disabled, allowClear = true, clearLabel = 'Any',
}: {
  label: string;
  placeholder?: string;
  options: Option<T>[];
  value: T | null;
  onChange: (v: T | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
  clearLabel?: string;
}) {
  // Labels must be unique for the round-trip; disambiguate duplicates rather
  // than silently selecting the first match.
  const rows = useMemo(() => {
    const seen = new Map<string, number>();
    const base = allowClear ? [{ value: null as T | null, label: clearLabel }] : [];
    return [
      ...base,
      ...options.map((o) => {
        const n = (seen.get(o.label) ?? 0) + 1;
        seen.set(o.label, n);
        return { value: o.value as T | null, label: n > 1 ? `${o.label} (${n})` : o.label };
      }),
    ];
  }, [options, allowClear, clearLabel]);

  const selected = rows.find((r) => r.value === value)?.label;

  return (
    <View style={styles.field}>
      <SelectField
        label={label}
        placeholder={placeholder ?? 'Select…'}
        value={selected}
        options={rows.map((r) => r.label)}
        disabled={disabled}
        onChange={(picked) => onChange(rows.find((r) => r.label === picked)?.value ?? null)}
      />
    </View>
  );
}

export function ToggleRow({
  label, help, value, onChange,
}: { label: string; help?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {help ? <Text style={styles.help}>{help}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: Colors.primary, false: Colors.outlineVariant }}
        thumbColor={Colors.white}
        accessibilityLabel={label}
      />
    </View>
  );
}

/**
 * The notify switch, with copy that says exactly who is reached.
 *
 * `notify: true` fans a notification out to EVERY ACTIVE member of the
 * organisation (a task is the exception — it notifies only the assignee), so
 * the audience is spelled out rather than left as a bare "Notify members".
 */
export function NotifyToggle({
  value, onChange, audience = 'every active member of this organisation', disabled,
}: { value: boolean; onChange: (v: boolean) => void; audience?: string; disabled?: boolean }) {
  return (
    <ToggleRow
      label="Send a notification"
      help={disabled
        ? 'Notifications are only sent when the item is first created.'
        : `Notifies ${audience}. This cannot be undone once sent.`}
      value={disabled ? false : value}
      onChange={(v) => { if (!disabled) onChange(v); }}
    />
  );
}

/** Editable list of short strings — meeting agenda, task checklist. */
export function StringListEditor({
  label, placeholder, items, onChange,
}: { label: string; placeholder: string; items: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft('');
  };

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {items.map((item, i) => (
        <View key={`${item}-${i}`} style={styles.listRow}>
          <Text style={styles.listIndex}>{i + 1}</Text>
          <Text style={styles.listText}>{item}</Text>
          <Pressable
            onPress={() => onChange(items.filter((_, j) => j !== i))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item}`}
          >
            <X size={16} color={Colors.error} strokeWidth={2.2} />
          </Pressable>
        </View>
      ))}
      <View style={styles.addRow}>
        <View style={{ flex: 1 }}>
          <TextInputField
            placeholder={placeholder}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
            returnKeyType="done"
          />
        </View>
        <Pressable onPress={add} style={styles.addBtn} accessibilityRole="button" accessibilityLabel={`Add to ${label}`}>
          <Plus size={18} color={Colors.onPrimary} strokeWidth={2.4} />
        </Pressable>
      </View>
    </View>
  );
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * Date + 24-hour time → RFC3339, which is what every `startsAt` / `endsAt` /
 * `dueDate` on the authoring endpoints requires (the server rejects anything
 * else with a 400 rather than silently zeroing it).
 *
 * `onChange(null)` whenever the pair is incomplete or the time is malformed, so
 * a half-filled field can never be submitted as a real timestamp.
 */
export function DateTimeField({
  label, value, onChange, optional, timeRequired = true,
}: {
  label: string;
  value: string | null;
  onChange: (rfc3339: string | null) => void;
  optional?: boolean;
  timeRequired?: boolean;
}) {
  const parsed = parseDateSafe(value);
  const [date, setDate] = useState(() => (parsed ? toLocalDate(parsed) : ''));
  const [time, setTime] = useState(() => (parsed ? toLocalTime(parsed) : ''));

  const timeInvalid = time.trim() !== '' && !TIME_RE.test(time.trim());

  const emit = (nextDate: string, nextTime: string) => {
    if (!nextDate) { onChange(null); return; }
    const t = nextTime.trim();
    if (!t) { onChange(timeRequired ? null : isoFrom(nextDate, '00:00')); return; }
    if (!TIME_RE.test(t)) { onChange(null); return; }
    onChange(isoFrom(nextDate, t));
  };

  const thisYear = new Date().getFullYear();

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}{optional ? ' (optional)' : ''}</Text>
      <DatePickerField
        value={date || undefined}
        minYear={thisYear - 1}
        maxYear={thisYear + 5}
        onChange={(d) => { setDate(d); emit(d, time); }}
      />
      <TextInputField
        label="Time (24h)"
        placeholder="18:30"
        value={time}
        keyboardType="numbers-and-punctuation"
        onChangeText={(t) => { setTime(t); emit(date, t); }}
        error={timeInvalid ? 'Use HH:MM, e.g. 18:30' : undefined}
      />
      {date && !time && timeRequired ? <FormNotice text="Pick a time as well — the date alone is not enough." /> : null}
    </View>
  );
}

function pad(n: number) { return String(n).padStart(2, '0'); }
function toLocalDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toLocalTime(d: Date) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

/** Local wall-clock date+time → an absolute RFC3339 instant. */
function isoFrom(date: string, time: string): string | null {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: Spacing.sm,
  },
  cardTitle: { ...Typography.titleMd, color: Colors.onSurface },
  field: { gap: Spacing.xs },
  fieldLabel: { ...Typography.labelMd, color: Colors.onSurface },
  help: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.onPrimary, fontWeight: '700' as const },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  listRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm,
  },
  listIndex: { ...Typography.labelSm, color: Colors.onSurfaceVariant, width: 16 },
  listText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  addBtn: {
    width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm,
  },
  noticeText: { ...Typography.labelSm, flex: 1 },
});
