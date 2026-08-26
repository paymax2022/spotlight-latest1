// ── Registration — schema-driven field renderer ──────────────────────────────
// Maps a RegistrationField's `type` to the app's existing inputs:
//   text/email/tel/number/url/textarea → TextInputField
//   date                               → DatePickerField
//   select                             → SelectField
//   checkbox                           → CheckboxField (this file)
//   multi_select                       → MultiSelectField (this file)
//   file                               → FileField (this file, expo pickers)
//   password                           → not rendered (account handled by auth)

import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Check, Paperclip, FileCheck2, X } from 'lucide-react-native';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import DatePickerField from '@/components/DatePickerField';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import type { RegistrationField, UploadedFileValue } from '../types/registration.types';
import { pickFileForField } from '../utils/filePicker';

interface Props {
  field: RegistrationField;
  value: unknown;
  error?: string;
  onChange: (key: string, value: unknown) => void;
  // Upload runner injected by the wizard so React Query owns the request.
  onUpload: (file: { uri: string; name: string; mimeType: string }) => Promise<UploadedFileValue>;
}

export default function FieldRenderer(props: Props) {
  const node = renderField(props);
  if (!node || !props.field.readOnly || !props.field.helpText) return node;
  // A locked field shows its value, so `helpText` never reaches the placeholder
  // — say WHY it is locked underneath it instead, or it just looks broken.
  return (
    <View>
      {node}
      <Text style={styles.lockedNote}>{props.field.helpText}</Text>
    </View>
  );
}

function renderField({ field, value, error, onChange, onUpload }: Props) {
  switch (field.type) {
    case 'password':
      // Account credentials are handled by the app's auth, not the wizard.
      return null;

    case 'textarea':
      return (
        <TextInputField
          label={labelText(field)}
          value={asString(value)}
          onChangeText={(t) => onChange(field.key, t)}
          placeholder={field.placeholder ?? field.helpText}
          editable={!field.readOnly}
          error={error}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      );

    case 'number':
      return (
        <TextInputField
          label={labelText(field)}
          value={asString(value)}
          onChangeText={(t) => onChange(field.key, t.replace(/[^0-9.]/g, ''))}
          placeholder={field.placeholder ?? field.helpText}
          editable={!field.readOnly}
          error={error}
          keyboardType="numeric"
        />
      );

    case 'email':
    case 'tel':
    case 'url':
    case 'text':
      return (
        <TextInputField
          label={labelText(field)}
          value={asString(value)}
          onChangeText={(t) => onChange(field.key, t)}
          placeholder={field.placeholder ?? field.helpText}
          editable={!field.readOnly}
          error={error}
          keyboardType={field.type === 'email' ? 'email-address' : field.type === 'tel' ? 'phone-pad' : field.type === 'url' ? 'url' : 'default'}
          autoCapitalize={field.type === 'email' || field.type === 'url' ? 'none' : 'sentences'}
        />
      );

    case 'date':
      return (
        <DatePickerField
          label={labelText(field)}
          value={asString(value) || undefined}
          onChange={(iso) => onChange(field.key, iso)}
          error={error}
        />
      );

    case 'select':
      return (
        <SelectField
          label={labelText(field)}
          value={asString(value) || undefined}
          options={field.options ?? []}
          onChange={(v) => onChange(field.key, v)}
          error={error}
          disabled={field.readOnly}
          placeholder={field.placeholder ?? 'Select an option'}
        />
      );

    case 'checkbox':
      return (
        <CheckboxField
          label={labelText(field)}
          checked={value === true}
          onToggle={() => onChange(field.key, !(value === true))}
          error={error}
        />
      );

    case 'multi_select':
      return (
        <MultiSelectField
          label={labelText(field)}
          options={field.options ?? []}
          selected={Array.isArray(value) ? (value as string[]) : []}
          onChange={(next) => onChange(field.key, next)}
          error={error}
        />
      );

    case 'file':
      return (
        <FileField
          field={field}
          value={value as UploadedFileValue | undefined}
          error={error}
          onUpload={onUpload}
          onChange={(v) => onChange(field.key, v)}
        />
      );

    default:
      return (
        <View style={styles.unsupported}>
          <Text style={styles.unsupportedText}>
            Unsupported field "{field.label}" ({field.type})
          </Text>
        </View>
      );
  }
}

function labelText(field: RegistrationField): string {
  return field.required ? `${field.label} *` : field.label;
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : '';
  return String(value);
}

// ── Checkbox ──────────────────────────────────────────────────────────────────

function CheckboxField({ label, checked, onToggle, error }: { label: string; checked: boolean; onToggle: () => void; error?: string }) {
  return (
    <View style={styles.wrapper}>
      <Pressable style={styles.checkRow} onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked }}>
        <View style={[styles.checkBox, checked && styles.checkBoxOn, !!error && styles.checkBoxError]}>
          {checked && <Check size={15} color={Colors.onPrimary} strokeWidth={3} />}
        </View>
        <Text style={styles.checkLabel}>{label}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

// ── Multi-select (chips) ──────────────────────────────────────────────────────

function MultiSelectField({ label, options, selected, onChange, error }: { label: string; options: string[]; selected: string[]; onChange: (next: string[]) => void; error?: string }) {
  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
  };
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chipWrap}>
        {options.map((opt) => {
          const on = selected.includes(opt);
          return (
            <Pressable key={opt} onPress={() => toggle(opt)} style={[styles.chip, on && styles.chipOn]}>
              {on && <Check size={13} color={Colors.onPrimary} strokeWidth={3} />}
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

// ── File upload ────────────────────────────────────────────────────────────────

function FileField({ field, value, error, onUpload, onChange }: { field: RegistrationField; value?: UploadedFileValue; error?: string; onUpload: Props['onUpload']; onChange: (v: UploadedFileValue | undefined) => void }) {
  const [busy, setBusy] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | undefined>();

  const handlePick = async () => {
    setLocalError(undefined);
    const picked = await pickFileForField(field.accept);
    if (!picked) return;
    setBusy(true);
    try {
      const uploaded = await onUpload(picked);
      onChange(uploaded);
    } catch {
      setLocalError('Upload failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{labelText(field)}</Text>
      {value?.previewUrl ? (
        <View style={[styles.fileRow, styles.fileRowDone]}>
          <FileCheck2 size={18} color={Colors.teal} />
          <Text style={styles.fileName} numberOfLines={1}>{value.fileName || 'Uploaded file'}</Text>
          <Pressable onPress={() => onChange(undefined)} hitSlop={8}>
            <X size={16} color={Colors.onSurfaceVariant} />
          </Pressable>
        </View>
      ) : (
        <Pressable style={[styles.fileRow, (!!error || !!localError) && styles.fileRowError]} onPress={handlePick} disabled={busy}>
          {busy ? <ActivityIndicator size="small" color={Colors.primary} /> : <Paperclip size={18} color={Colors.primary} />}
          <Text style={styles.filePlaceholder}>{busy ? 'Uploading…' : 'Tap to choose a file'}</Text>
        </Pressable>
      )}
      {field.accept ? <Text style={styles.helpText}>Accepted: {field.accept}</Text> : null}
      {(error || localError) ? <Text style={styles.error}>{error ?? localError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  helpText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.xs },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  checkBox: {
    width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 1.5,
    borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  checkBoxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkBoxError: { borderColor: Colors.error },
  checkLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, lineHeight: 22 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant,
  },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { ...Typography.labelMd, color: Colors.onSurface },
  chipTextOn: { color: Colors.onPrimary },

  fileRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    height: 56, paddingHorizontal: Spacing.md, borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant,
  },
  fileRowDone: { borderColor: Colors.teal, borderStyle: 'solid' },
  fileRowError: { borderColor: Colors.error },
  filePlaceholder: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, flex: 1 },
  fileName: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },

  lockedNote: {
    ...Typography.caption,
    color: Colors.onSurfaceVariant,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.md,
  },
  unsupported: {
    padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.errorContainer, marginBottom: Spacing.md,
  },
  unsupportedText: { ...Typography.labelSm, color: Colors.error },
});
