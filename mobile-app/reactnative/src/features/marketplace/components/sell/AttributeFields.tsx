// ── Sell — dynamic attribute form (Attribute form, screen 12) ────────────────
// Renders a form from the selected category's attribute schema (GET /categories/:id
// → attributeSchema). Required-field validation is inline, never on-submit-only.
//
// Architecture mirrors features/insurance/components/live/DynamicField.tsx: one
// switch over the field's widget type, composing existing shared form controls
// rather than hand-rolling inputs per type. 'enum'/'bool' are legacy aliases —
// pre-existing fixtures/DB rows keep rendering exactly as 'select'/'toggle' do.
//
// Widget catalog: text | number | currency | select (enum) | multiselect |
// radio | segmented | toggle (bool) | stepper | date | color.
import React from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { MarketColors } from '@/features/marketplace';
import SelectField from '@/components/SelectField';
import MultiSelectField from '@/components/MultiSelectField';
import DatePickerField from '@/components/DatePickerField';
import SegmentedControl from '@/components/SegmentedControl';
import TextInputField from '@/components/TextInputField';
import Stepper from '@/components/Stepper';
import ColorSwatchPicker from '@/components/ColorSwatchPicker';
import { sanitizeMoneyInput } from '@/utils/money';
import type { AttributeField, AttributeFieldOption, AttributeSchema } from '@/features/marketplace/api/sell.api';

/** Normalize whatever the category returns into an AttributeSchema. Tolerates the
 *  discovery mock's empty `{}` schema (returns no fields → the step is skipped). */
export function normalizeSchema(raw: unknown): AttributeSchema {
  if (raw && typeof raw === 'object' && Array.isArray((raw as AttributeSchema).fields)) {
    return raw as AttributeSchema;
  }
  return { fields: [] };
}

/** undefined/null/blank-string/empty-array all read as "nothing entered yet". */
function isEmptyAttributeValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function missingRequired(schema: AttributeSchema, values: Record<string, unknown>): string[] {
  return schema.fields
    .filter((f) => f.required)
    .filter((f) => isEmptyAttributeValue(values[f.key]))
    .map((f) => f.label);
}

/** 'enum'/'bool' are pre-existing-fixture aliases of 'select'/'toggle' — the
 *  dispatcher below treats each pair identically. */
type ResolvedType = Exclude<AttributeField['type'], 'enum' | 'bool'>;

function resolveType(type: AttributeField['type']): ResolvedType {
  if (type === 'enum') return 'select';
  if (type === 'bool') return 'toggle';
  return type;
}

function composeLabel(field: AttributeField): string {
  const unit = field.unit ? ` (${field.unit})` : '';
  const optional = field.required ? '' : ' (optional)';
  return `${field.label}${unit}${optional}`;
}

function humanizeKey(key: string): string {
  return key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

interface Dependency {
  /** True while the parent field named by `dependsOnKey` has no value yet —
   *  the control renders as a locked placeholder instead of the real input. */
  waiting: boolean;
  parentLabel: string;
  /** `field.options`, filtered to those whose `dependsOnValue` matches the
   *  parent's current value (options with no `dependsOnValue` always show). */
  options: AttributeFieldOption[];
}

function resolveDependency(
  field: AttributeField,
  values: Record<string, unknown>,
  labelForKey: (key: string) => string,
): Dependency {
  const options = field.options ?? [];
  if (!field.dependsOnKey) return { waiting: false, parentLabel: '', options };

  const parentValue = values[field.dependsOnKey];
  if (isEmptyAttributeValue(parentValue)) {
    return { waiting: true, parentLabel: labelForKey(field.dependsOnKey), options: [] };
  }
  const filtered = options.filter((o) => o.dependsOnValue == null || o.dependsOnValue === String(parentValue));
  return { waiting: false, parentLabel: '', options: filtered };
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

  const labelForKey = (key: string) => schema.fields.find((f) => f.key === key)?.label ?? humanizeKey(key);

  let lastGroup: string | undefined;

  return (
    <View style={styles.wrap}>
      {schema.fields.map((f) => {
        const groupHeading =
          f.group && f.group !== lastGroup ? (
            <Text key={`group_${f.group}_${f.key}`} style={styles.groupHeading}>
              {f.group}
            </Text>
          ) : null;
        lastGroup = f.group;
        return (
          <React.Fragment key={f.key}>
            {groupHeading}
            <FieldRow
              field={f}
              values={values}
              value={values[f.key]}
              onChange={(v) => onChange(f.key, v)}
              showError={!!showErrors}
              labelForKey={labelForKey}
            />
          </React.Fragment>
        );
      })}
    </View>
  );
}

function FieldRow({
  field,
  values,
  value,
  onChange,
  showError,
  labelForKey,
}: {
  field: AttributeField;
  values: Record<string, unknown>;
  value: unknown;
  onChange: (v: unknown) => void;
  showError: boolean;
  labelForKey: (key: string) => string;
}) {
  const type = resolveType(field.type);
  const label = composeLabel(field);
  const invalid = showError && field.required && isEmptyAttributeValue(value);
  const errorText = invalid ? `${field.label} is required.` : undefined;

  const dep = resolveDependency(field, values, labelForKey);
  if (dep.waiting) {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.locked}>
          <Text style={styles.lockedText}>Choose {dep.parentLabel} first</Text>
        </View>
      </View>
    );
  }
  const options = dep.options;

  switch (type) {
    case 'select': {
      const labels = options.map((o) => o.label);
      const selectedLabel = options.find((o) => o.value === value)?.label ?? '';
      return (
        <SelectField
          label={label}
          value={selectedLabel}
          options={labels}
          error={errorText}
          searchable={labels.length > 8}
          onChange={(picked) => {
            const opt = options.find((o) => o.label === picked);
            onChange(opt?.value ?? picked);
          }}
        />
      );
    }

    case 'multiselect': {
      const labels = options.map((o) => o.label);
      const selectedValues = Array.isArray(value) ? (value as string[]) : [];
      const selectedLabels = selectedValues
        .map((v) => options.find((o) => o.value === v)?.label)
        .filter((l): l is string => !!l);
      return (
        <MultiSelectField
          label={label}
          value={selectedLabels}
          options={labels}
          error={errorText}
          searchable={labels.length > 8}
          onChange={(picked) =>
            onChange(picked.map((l) => options.find((o) => o.label === l)?.value).filter((v): v is string => !!v))
          }
        />
      );
    }

    case 'radio': {
      // A short list reads better as an always-visible track than as a picker
      // that hides its own options behind a sheet.
      if (options.length > 0 && options.length <= 4) {
        return (
          <View style={styles.field}>
            <Text style={styles.label}>{label}</Text>
            <SegmentedControl
              options={options.map((o) => ({ value: o.value, label: o.label }))}
              value={typeof value === 'string' ? value : ''}
              onChange={onChange}
            />
            {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
          </View>
        );
      }
      const labels = options.map((o) => o.label);
      const selectedLabel = options.find((o) => o.value === value)?.label ?? '';
      return (
        <SelectField
          label={label}
          value={selectedLabel}
          options={labels}
          error={errorText}
          searchable={labels.length > 8}
          onChange={(picked) => {
            const opt = options.find((o) => o.label === picked);
            onChange(opt?.value ?? picked);
          }}
        />
      );
    }

    case 'segmented':
      return (
        <View style={styles.field}>
          <Text style={styles.label}>{label}</Text>
          <SegmentedControl
            options={options.map((o) => ({ value: o.value, label: o.label }))}
            value={typeof value === 'string' ? value : ''}
            onChange={onChange}
            scrollable={options.length > 4}
          />
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </View>
      );

    case 'toggle':
      return (
        <View style={styles.field}>
          <View style={styles.toggleRow}>
            <Text style={styles.label}>{label}</Text>
            <Switch value={value === true} onValueChange={onChange} trackColor={{ true: MarketColors.brand }} />
          </View>
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </View>
      );

    case 'stepper':
      return (
        <Stepper
          label={label}
          value={typeof value === 'number' ? value : Number(value) || field.min || 0}
          onChange={onChange}
          min={field.min}
          max={field.max}
          error={errorText}
        />
      );

    case 'date':
      return (
        <DatePickerField
          label={label}
          value={typeof value === 'string' ? value : undefined}
          onChange={onChange}
          error={errorText}
        />
      );

    case 'color':
      return (
        <ColorSwatchPicker
          label={label}
          options={options.map((o) => ({ value: o.value, label: o.label }))}
          value={typeof value === 'string' ? value : undefined}
          onChange={onChange}
          error={errorText}
        />
      );

    case 'currency':
      return (
        <TextInputField
          label={label}
          value={value == null ? '' : String(value)}
          onChangeText={(raw) => onChange(sanitizeMoneyInput(raw))}
          placeholder={field.placeholder ?? '0'}
          error={errorText}
          keyboardType="decimal-pad"
          inputMode="decimal"
          maxLength={13}
        />
      );

    case 'number':
      return (
        <TextInputField
          label={label}
          value={value == null ? '' : String(value)}
          onChangeText={(raw) => onChange(raw.replace(/[^\d]/g, ''))}
          placeholder={field.placeholder ?? ''}
          error={errorText}
          keyboardType="numeric"
        />
      );

    case 'text':
    default:
      return (
        <TextInputField
          label={label}
          value={value == null ? '' : String(value)}
          onChangeText={onChange}
          placeholder={field.placeholder ?? ''}
          error={errorText}
        />
      );
  }
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.md },
  emptyText: { ...Typography.bodyMd, color: MarketColors.muted },
  groupHeading: { ...Typography.titleMd, color: MarketColors.text, marginTop: Spacing.xs },
  field: { gap: 6 },
  label: { ...Typography.labelLg, color: MarketColors.text, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  errorText: { ...Typography.labelSm, color: MarketColors.danger },
  locked: {
    borderWidth: 1,
    borderColor: MarketColors.border,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    backgroundColor: MarketColors.surfaceAlt,
  },
  lockedText: { ...Typography.bodyMd, color: MarketColors.muted },
});
