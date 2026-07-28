import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Check, Paperclip, FileText, X, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import TextInputField from '@/components/TextInputField';
import DatePickerField from '@/components/DatePickerField';
import type { IntakeField as IntakeFieldType, IntakeValue, IntakeAttachment } from '../types';
import { HealthColors } from '../constants/health.constants';

// ── Medication list helpers (med_list field, M6) ──────────────────────────────
// Stored as a JSON string of {name, dose} so it fits IntakeValue (string) and the
// answers payload without a schema/type change. Tolerates a legacy plain-text
// value (treated as a single medication name).
type Med = { name: string; dose: string };
function parseMeds(v: IntakeValue): Med[] {
  if (typeof v !== 'string' || !v.trim()) return [];
  try {
    const arr = JSON.parse(v);
    if (Array.isArray(arr)) return arr.map((m) => ({ name: String(m?.name ?? ''), dose: String(m?.dose ?? '') }));
  } catch { /* legacy free-text → one med */ }
  return [{ name: v, dose: '' }];
}
function serializeMeds(meds: Med[]): IntakeValue {
  const clean = meds.filter((m) => m.name.trim() || m.dose.trim());
  return clean.length ? JSON.stringify(clean) : ''; // empty → '' so required/validation treats it as blank
}

interface Props {
  field: IntakeFieldType;
  value: IntakeValue;
  error?: string;
  onChange: (value: IntakeValue) => void;
  /** Attachment fields (M12): open the picker → presign → PUT. Resolves on done. */
  onPickAttachment?: (field: IntakeFieldType) => void;
  /** Already-uploaded attachments for this field (M12). */
  attachments?: IntakeAttachment[];
  onRemoveAttachment?: (id: string) => void;
  attachmentBusy?: boolean;
}

/** "Patient-reported" chip — never present intake as a diagnosis (PRD §5.3). */
function PatientReportedTag() {
  return (
    <View style={styles.prTag}>
      <Text style={styles.prText}>Patient-reported</Text>
    </View>
  );
}

/**
 * Single schema-driven field renderer. One renderer covers every supported
 * field type; the intake screen maps a schema of N fields onto this. Field-level
 * validation errors are surfaced inline (HEALTH-BUILD: map field errors).
 */
export default function IntakeField({
  field,
  value,
  error,
  onChange,
  onPickAttachment,
  attachments,
  onRemoveAttachment,
  attachmentBusy,
}: Props) {
  const labelNode = (
    <View style={styles.labelRow}>
      <Text style={styles.label}>
        {field.label}
        {field.required ? <Text style={styles.req}> *</Text> : null}
      </Text>
      {field.patientReported ? <PatientReportedTag /> : null}
    </View>
  );

  // ── Scale (1–10 severity chips — no slider lib, PRD M5) ─────────────────────
  if (field.type === 'scale') {
    const min = field.min ?? 1;
    const max = field.max ?? 10;
    const current = typeof value === 'number' ? value : null;
    const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    return (
      <View style={styles.wrap}>
        {labelNode}
        {field.help ? <Text style={styles.help}>{field.help}</Text> : null}
        <View style={styles.scaleRow}>
          {steps.map((n) => {
            const active = current === n;
            return (
              <Pressable
                key={n}
                onPress={() => onChange(n)}
                accessibilityRole="radio"
                accessibilityLabel={`Severity ${n}`}
                accessibilityState={{ selected: active }}
                style={[styles.scaleChip, active && styles.scaleChipActive, !!error && styles.errored]}
              >
                <Text style={[styles.scaleText, active && styles.scaleTextActive]}>{n}</Text>
              </Pressable>
            );
          })}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  // ── Attachment (photos / lab results / prescriptions, PRD M12) ──────────────
  if (field.type === 'attachment') {
    const list = attachments ?? [];
    return (
      <View style={styles.wrap}>
        {labelNode}
        {field.help ? <Text style={styles.help}>{field.help}</Text> : null}
        {list.map((att) => (
          <View key={att.id} style={styles.attRow}>
            <FileText size={16} color={HealthColors.accent} strokeWidth={2} />
            <Text style={styles.attName} numberOfLines={1}>{att.fileName}</Text>
            {onRemoveAttachment ? (
              <Pressable onPress={() => onRemoveAttachment(att.id)} hitSlop={8} accessibilityLabel={`Remove ${att.fileName}`}>
                <X size={16} color={Colors.onSurfaceVariant} />
              </Pressable>
            ) : null}
          </View>
        ))}
        <Pressable
          onPress={() => onPickAttachment?.(field)}
          disabled={attachmentBusy}
          accessibilityRole="button"
          style={[styles.attBtn, attachmentBusy && styles.disabled]}
        >
          {attachmentBusy ? (
            <ActivityIndicator size="small" color={HealthColors.accent} />
          ) : (
            <Paperclip size={16} color={HealthColors.accent} strokeWidth={2} />
          )}
          <Text style={styles.attBtnText}>{attachmentBusy ? 'Uploading…' : 'Add a file'}</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  // ── Date → real date-picker widget (PRD: "when did it start" uses a date widget) ──
  if (field.type === 'date') {
    return (
      <View style={styles.wrap}>
        <DatePickerField
          label={field.label + (field.required ? ' *' : '')}
          value={typeof value === 'string' && value ? value : undefined}
          onChange={(iso) => onChange(iso)}
        />
        {field.help ? <Text style={styles.help}>{field.help}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  // ── Medication list → repeatable name + dose rows ("add another") ────────────
  if (field.type === 'med_list') {
    const parsed = parseMeds(value);
    const rows: Med[] = parsed.length ? parsed : [{ name: '', dose: '' }];
    const update = (i: number, patch: Partial<Med>) =>
      onChange(serializeMeds(rows.map((m, idx) => (idx === i ? { ...m, ...patch } : m))));
    const add = () => onChange(serializeMeds([...rows, { name: '', dose: '' }]));
    const remove = (i: number) => onChange(serializeMeds(rows.filter((_, idx) => idx !== i)));
    return (
      <View style={styles.wrap}>
        {labelNode}
        {field.help ? <Text style={styles.help}>{field.help}</Text> : null}
        {rows.map((m, i) => (
          <View key={i} style={styles.medRow}>
            <View style={styles.medInputs}>
              <TextInputField
                label={i === 0 ? 'Medication' : undefined}
                placeholder="e.g. Amlodipine"
                value={m.name}
                onChangeText={(t) => update(i, { name: t })}
              />
              <TextInputField
                label={i === 0 ? 'Dose & how often' : undefined}
                placeholder="e.g. 5mg once daily"
                value={m.dose}
                onChangeText={(t) => update(i, { dose: t })}
              />
            </View>
            {rows.length > 1 || m.name || m.dose ? (
              <Pressable onPress={() => remove(i)} hitSlop={8} style={styles.medRemove} accessibilityLabel="Remove this medication">
                <X size={16} color={Colors.onSurfaceVariant} />
              </Pressable>
            ) : null}
          </View>
        ))}
        <Pressable onPress={add} style={styles.addBtn} accessibilityRole="button">
          <Plus size={16} color={HealthColors.accent} strokeWidth={2.2} />
          <Text style={styles.addBtnText}>Add another medication</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  // ── Free-text / number → reuse the shared TextInputField ────────────────────
  if (field.type === 'short_text' || field.type === 'long_text' || field.type === 'number') {
    return (
      <View style={styles.wrap}>
        <TextInputField
          label={field.label + (field.required ? ' *' : '')}
          placeholder={field.placeholder}
          value={value == null ? '' : String(value)}
          onChangeText={(t) => {
            if (field.type !== 'number') return onChange(t);
            // Empty or non-numeric input → null, so optional number fields (e.g.
            // self-reported vitals) never store NaN and never block the step.
            const n = Number(t);
            onChange(t.trim() === '' || Number.isNaN(n) ? null : n);
          }}
          keyboardType={field.type === 'number' ? 'numeric' : 'default'}
          multiline={field.type === 'long_text'}
          error={error}
        />
        {field.help ? <Text style={styles.help}>{field.help}</Text> : null}
      </View>
    );
  }

  // ── Boolean (yes/no) ────────────────────────────────────────────────────────
  if (field.type === 'boolean') {
    const bool = value === true;
    return (
      <View style={styles.wrap}>
        {labelNode}
        {field.help ? <Text style={styles.help}>{field.help}</Text> : null}
        <View style={styles.boolRow}>
          {[
            { v: true, label: 'Yes' },
            { v: false, label: 'No' },
          ].map((opt) => {
            const active = bool === opt.v && value != null;
            return (
              <Pressable
                key={opt.label}
                onPress={() => onChange(opt.v)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={[styles.boolBtn, active && styles.boolBtnActive, !!error && styles.errored]}
              >
                <Text style={[styles.boolText, active && styles.boolTextActive]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  // ── Single / multi select (option chips) ────────────────────────────────────
  const selected: string[] =
    field.type === 'multi_select' ? (Array.isArray(value) ? value : []) : value != null ? [String(value)] : [];

  const toggle = (optValue: string) => {
    if (field.type === 'single_select') {
      onChange(optValue);
      return;
    }
    const set = new Set(selected);
    if (set.has(optValue)) set.delete(optValue);
    else set.add(optValue);
    onChange(Array.from(set));
  };

  return (
    <View style={styles.wrap}>
      {labelNode}
      {field.help ? <Text style={styles.help}>{field.help}</Text> : null}
      <View style={styles.options}>
        {(field.options ?? []).map((opt) => {
          const active = selected.includes(opt.value);
          return (
            <Pressable
              key={opt.value}
              onPress={() => toggle(opt.value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              style={[styles.opt, active && styles.optActive, !!error && styles.errored]}
            >
              {active ? <Check size={14} color={HealthColors.accent} strokeWidth={2.6} /> : null}
              <Text style={[styles.optText, active && styles.optTextActive]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.md },
  labelRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.xs },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  req: { color: Colors.error },
  prTag: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: Colors.surfaceContainerHigh },
  prText: { ...Typography.caption, color: Colors.onSurfaceVariant, fontWeight: '600' as const },
  disabled: { opacity: 0.6 },
  // scale (1–10)
  scaleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scaleChip: {
    width: 40, height: 44, borderRadius: Radius.md, borderWidth: 1.5,
    borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center', justifyContent: 'center',
  },
  scaleChipActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  scaleText: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  scaleTextActive: { color: Colors.secondary, fontWeight: '800' as const },
  // attachments
  attRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm + 2, paddingVertical: 10, marginBottom: Spacing.sm,
  },
  attName: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  attBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    height: 48, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest,
  },
  attBtnText: { ...Typography.labelLg, color: HealthColors.accent },
  // medication list (repeatable)
  medRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginBottom: Spacing.sm },
  medInputs: { flex: 1, gap: Spacing.xs },
  medRemove: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow, marginTop: 4 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    height: 46, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest,
  },
  addBtnText: { ...Typography.labelMd, color: HealthColors.accent },
  help: { ...Typography.caption, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  // boolean
  boolRow: { flexDirection: 'row', gap: Spacing.sm },
  boolBtn: {
    flex: 1,
    height: 52,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.transparent,
    backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boolBtnActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  boolText: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  boolTextActive: { color: Colors.secondary },
  errored: { borderColor: Colors.error },
  // select
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  optActive: { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  optText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  optTextActive: { color: Colors.secondary },
});
