// ── Sell — dynamic attribute form (Attribute form, screen 12) ────────────────
// Renders a form from the selected category's attribute schema (GET /categories/:id
// → attributeSchema). Required-field validation is inline, never on-submit-only.
// Field types: text | number | enum (chips) | bool (toggle).
import React from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, Switch } from 'react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors } from '@/features/marketplace';
import type { AttributeField, AttributeSchema } from '@/features/marketplace/api/sell.api';

/** Normalize whatever the category returns into an AttributeSchema. Tolerates the
 *  discovery mock's empty `{}` schema (returns no fields → the step is skipped). */
export function normalizeSchema(raw: unknown): AttributeSchema {
  if (raw && typeof raw === 'object' && Array.isArray((raw as AttributeSchema).fields)) {
    return raw as AttributeSchema;
  }
  return { fields: [] };
}

export function missingRequired(schema: AttributeSchema, values: Record<string, unknown>): string[] {
  return schema.fields
    .filter((f) => f.required)
    .filter((f) => {
      const v = values[f.key];
      return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    })
    .map((f) => f.label);
}

interface Props {
  schema: AttributeSchema;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** show inline errors for required fields that are empty (after a submit attempt). */
  showErrors?: boolean;
}

export default function AttributeFields({ schema, values, onChange, showErrors }: Props) {
  if (schema.fields.length === 0) {
    return <Text style={styles.emptyText}>No extra details needed for this category — you're good to go.</Text>;
  }

  return (
    <View style={styles.wrap}>
      {schema.fields.map((f) => (
        <FieldRow key={f.key} field={f} value={values[f.key]} onChange={(v) => onChange(f.key, v)} showError={!!showErrors} />
      ))}
    </View>
  );
}

function FieldRow({ field, value, onChange, showError }: { field: AttributeField; value: unknown; onChange: (v: unknown) => void; showError: boolean }) {
  const empty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  const invalid = showError && field.required && empty;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {field.label}
        {field.required ? <Text style={styles.req}> *</Text> : null}
        {field.unit ? <Text style={styles.unit}> ({field.unit})</Text> : null}
      </Text>

      {field.type === 'enum' ? (
        <View style={styles.chipRow}>
          {(field.options ?? []).map((o) => {
            const active = value === o.value;
            return (
              <Pressable key={o.value} style={[styles.chip, active && styles.chipActive]} onPress={() => onChange(o.value)} accessibilityRole="button">
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : field.type === 'bool' ? (
        <Switch value={value === true} onValueChange={onChange} trackColor={{ true: MarketColors.brand }} />
      ) : (
        <TextInput
          style={[styles.input, invalid && styles.inputInvalid]}
          value={value == null ? '' : String(value)}
          onChangeText={onChange}
          placeholder={field.placeholder ?? ''}
          placeholderTextColor={MarketColors.muted}
          keyboardType={field.type === 'number' ? 'numeric' : 'default'}
        />
      )}

      {invalid ? <Text style={styles.errorText}>{field.label} is required.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.md },
  emptyText: { ...Typography.bodyMd, color: MarketColors.muted },
  field: { gap: 6 },
  label: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700' },
  req: { color: MarketColors.danger },
  unit: { ...Typography.labelSm, color: MarketColors.muted, fontWeight: '400' },
  input: { ...Typography.bodyMd, color: MarketColors.text, borderWidth: 1, borderColor: MarketColors.border, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: 12, backgroundColor: MarketColors.surface },
  inputInvalid: { borderColor: MarketColors.danger },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1, borderColor: MarketColors.border, backgroundColor: MarketColors.surface },
  chipActive: { borderColor: MarketColors.brand, backgroundColor: MarketColors.okBg },
  chipText: { ...Typography.labelMd, color: MarketColors.muted },
  chipTextActive: { color: MarketColors.brand, fontWeight: '700' },
  errorText: { ...Typography.labelSm, color: MarketColors.danger },
});
