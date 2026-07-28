import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import DatePickerField from '@/components/DatePickerField';
import { ChipMultiSelect, UploadField, ToggleRow } from '@/features/doctor/components';
import type { UploadFieldState } from '@/features/doctor/components';
import type { DocumentValue, FieldValue, FormField } from '@/types/merchant';

interface Props {
  field:   FormField;
  value:   FieldValue;
  error?:  string;
  onChange: (value: FieldValue) => void;
}

// New component: the form-schema field renderer (FR-8/FR-9). No existing
// component maps a typed schema field to the right input, so this dispatcher is
// genuinely new — but it BUILDS NOTHING itself: every concrete input delegates
// to an already-shipped component (TextInputField, SelectField, DatePickerField,
// ChipMultiSelect, UploadField, ToggleRow). Keeps the wizard tokens consistent.
export default function DynamicField({ field, value, error, onChange }: Props) {
  switch (field.type) {
    case 'select': {
      const opts = field.options ?? [];
      const selectedLabel = opts.find((o) => o.value === value)?.label;
      return (
        <SelectField
          label={field.label}
          placeholder={field.placeholder ?? 'Select an option'}
          value={selectedLabel}
          options={opts.map((o) => o.label)}
          onChange={(label) => onChange(opts.find((o) => o.label === label)?.value ?? label)}
          error={error}
        />
      );
    }

    case 'multiselect': {
      const opts = field.options ?? [];
      const selectedValues = Array.isArray(value) ? value : [];
      const selectedLabels = opts.filter((o) => selectedValues.includes(o.value)).map((o) => o.label);
      return (
        <View style={styles.block}>
          <ChipMultiSelect
            label={field.label}
            options={opts.map((o) => o.label)}
            selected={selectedLabels}
            max={field.maxSelections}
            onChange={(labels) => onChange(opts.filter((o) => labels.includes(o.label)).map((o) => o.value))}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
        </View>
      );
    }

    case 'date':
      return (
        <DatePickerField
          label={field.label}
          value={typeof value === 'string' ? value : undefined}
          onChange={onChange}
          error={error}
          minYear={1950}
          maxYear={new Date().getFullYear() + 10}
        />
      );

    case 'boolean':
      return (
        <View style={styles.block}>
          <ToggleRow
            label={field.label}
            description={field.helpText}
            value={value === true}
            onValueChange={onChange}
          />
        </View>
      );

    case 'document': {
      const doc = (value && typeof value === 'object' && 'fileName' in value) ? (value as DocumentValue) : null;
      const state: UploadFieldState = doc ? 'uploaded' : 'empty';
      return (
        <UploadField
          label={field.label}
          required={field.required}
          state={state}
          fileName={doc?.fileName}
          hint={field.helpText}
          // Phase A stubs the picker (matches the doctor flow's stubbed upload).
          onPick={() => onChange({
            fileName: `${field.key}.pdf`,
            uploadedAt: new Date().toISOString(),
            expiryDate: field.hasExpiry ? null : undefined,
            status: 'pending',
          } as DocumentValue)}
        />
      );
    }

    case 'currency':
      return (
        <TextInputField
          label={field.label}
          placeholder={field.placeholder ?? '0.00'}
          keyboardType="decimal-pad"
          value={value != null && value !== '' ? formatNairaInput(value) : ''}
          onChangeText={(t) => onChange(parseNairaToKobo(t))}
          error={error}
        />
      );

    case 'number':
      return (
        <TextInputField
          label={field.label}
          placeholder={field.placeholder}
          keyboardType="number-pad"
          value={value != null && value !== '' ? String(value) : ''}
          onChangeText={(t) => onChange(t === '' ? '' : Number(t.replace(/[^\d]/g, '')))}
          error={error}
        />
      );

    case 'address':
    case 'textarea':
      return (
        <TextInputField
          label={field.label}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          error={error}
          multiline
          numberOfLines={3}
        />
      );

    case 'email':
      return (
        <TextInputField
          label={field.label} placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''} onChangeText={onChange}
          error={error} keyboardType="email-address" autoCapitalize="none"
        />
      );

    case 'phone':
      return (
        <TextInputField
          label={field.label} placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''} onChangeText={onChange}
          error={error} keyboardType="phone-pad"
        />
      );

    case 'text':
    default:
      return (
        <TextInputField
          label={field.label}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          error={error}
        />
      );
  }
}

// Currency is stored as kobo (integer). Display in naira, store in minor units.
function parseNairaToKobo(text: string): number {
  const naira = Number(text.replace(/[^\d.]/g, ''));
  if (Number.isNaN(naira)) return 0;
  return Math.round(naira * 100);
}
function formatNairaInput(kobo: FieldValue): string {
  const n = typeof kobo === 'number' ? kobo : Number(kobo);
  if (Number.isNaN(n)) return '';
  return (n / 100).toString();
}

const styles = StyleSheet.create({
  block: { marginBottom: Spacing.md },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
});
