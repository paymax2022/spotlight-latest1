// ── Insurance (live) — one schema field, rendered ───────────────────────────
// Every one of MyCover's 68 products has its own required-field schema, so no
// screen may hardcode an input. This component is the whole vocabulary: give it
// a `Field` and it draws the right control, with the provider's own constraints
// (NIN exactly 11 digits, address ≥ 6 chars, cargo_value ≥ ₦5,000, LGA enum)
// enforced on the way in.

import React, { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Camera, FileUp, ImagePlus, Paperclip, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import DatePickerField from '@/components/DatePickerField';
import MultiSelectField from '@/components/MultiSelectField';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import { alertAsync } from '@/lib/confirm';
import { sanitizeMoneyInput } from '@/utils/money';
import { InsuranceColors } from '../../constants/insurance.constants';
import { uploadInsuranceFile } from '../../live/api';
import { asList, asText, boundInFieldUnits } from '../../live/formEngine';
import { nairaFromKobo } from '../../live/money';
import type { Field, FieldValue, InsuranceError } from '../../live/types';

export default function DynamicField({
  field,
  value,
  error,
  onChange,
}: {
  field: Field;
  value: FieldValue | undefined;
  error?: string;
  onChange: (v: FieldValue) => void;
}) {
  const label = field.required ? field.label : `${field.label} (optional)`;

  switch (field.type) {
    case 'select': {
      const options = field.options ?? [];
      // A short enum (Male|Female, Laptop|Phone|Tablet|Others) reads better as
      // one tap-row than as a picker that hides its own options behind a sheet.
      const compact =
        options.length > 0 &&
        options.length <= 4 &&
        options.every((o) => o.label.length <= 12);
      return compact ? (
        <ChoiceRow field={field} label={label} value={asText(value)} error={error} onChange={onChange} />
      ) : (
        <SelectControl field={field} label={label} value={asText(value)} error={error} onChange={onChange} />
      );
    }

    case 'multiselect':
      return <MultiSelectControl field={field} label={label} value={asList(value)} error={error} onChange={onChange} />;

    case 'date':
      return (
        <View>
          <DatePickerField
            label={label}
            value={asText(value)}
            error={error}
            minYear={yearOf(field.minDate)}
            maxYear={yearOf(field.maxDate)}
            onChange={(iso) => onChange(iso)}
          />
          <Help field={field} />
        </View>
      );

    case 'file':
    case 'image':
      return <UploadControl field={field} label={label} value={asText(value)} error={error} onChange={onChange} />;

    default:
      return <TextControl field={field} label={label} value={asText(value)} error={error} onChange={onChange} />;
  }
}

// ── Text-family control (text / email / phone / number / money / nin / address)
function TextControl({
  field,
  label,
  value,
  error,
  onChange,
}: {
  field: Field;
  label: string;
  value: string;
  error?: string;
  onChange: (v: FieldValue) => void;
}) {
  const multiline = field.type === 'address' || (field.maxLength ?? 0) > 120;

  return (
    <View>
      <TextInputField
        label={label}
        value={value}
        error={error}
        placeholder={field.placeholder ?? defaultPlaceholder(field)}
        onChangeText={(raw) => onChange(sanitizeFor(field, raw))}
        keyboardType={keyboardFor(field)}
        autoCapitalize={autoCapitalizeFor(field)}
        autoCorrect={field.type === 'text' || field.type === 'address'}
        maxLength={hardMaxLength(field)}
        multiline={multiline}
        numberOfLines={multiline ? 3 : undefined}
        textContentType={field.type === 'email' ? 'emailAddress' : undefined}
        inputMode={field.type === 'email' ? 'email' : undefined}
      />
      <Help field={field} value={value} />
    </View>
  );
}

// ── Select ──────────────────────────────────────────────────────────────────
function SelectControl({
  field,
  label,
  value,
  error,
  onChange,
}: {
  field: Field;
  label: string;
  value: string;
  error?: string;
  onChange: (v: FieldValue) => void;
}) {
  const options = field.options ?? [];
  // SelectField is label-driven, so map label⇄value at this boundary. Enum
  // values like "ABIA-Aba" must reach the provider verbatim.
  const labels = options.map((o) => o.label);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? '';

  return (
    <View>
      <SelectField
        label={label}
        value={selectedLabel}
        options={labels}
        error={error}
        placeholder={field.placeholder ?? `Select ${field.label.toLowerCase()}`}
        searchable={labels.length > 8}
        onChange={(picked) => {
          const opt = options.find((o) => o.label === picked);
          onChange(opt?.value ?? picked);
        }}
      />
      <Help field={field} />
    </View>
  );
}

/** Tap-row for short enums — the options stay visible instead of hiding in a sheet. */
function ChoiceRow({
  field,
  label,
  value,
  error,
  onChange,
}: {
  field: Field;
  label: string;
  value: string;
  error?: string;
  onChange: (v: FieldValue) => void;
}) {
  const options = field.options ?? [];
  return (
    <View style={styles.choiceWrap}>
      <Text style={styles.uploadLabel}>{label}</Text>
      <View style={styles.choiceRow}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={[styles.choice, active && styles.choiceActive, !!error && !active && styles.choiceError]}
            >
              <Text style={[styles.choiceLabel, active && styles.choiceLabelActive]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : <Help field={field} />}
    </View>
  );
}

function MultiSelectControl({
  field,
  label,
  value,
  error,
  onChange,
}: {
  field: Field;
  label: string;
  value: string[];
  error?: string;
  onChange: (v: FieldValue) => void;
}) {
  const options = field.options ?? [];
  const labels = options.map((o) => o.label);
  const selectedLabels = value
    .map((v) => options.find((o) => o.value === v)?.label)
    .filter((l): l is string => !!l);

  // With no enum to choose from (e.g. `office_items[]`, `cargo_details[]`) the
  // provider expects free text, so fall back to a comma-separated entry rather
  // than showing an empty picker the user cannot get past.
  if (options.length === 0) {
    return <FreeTextList field={field} label={label} value={value} error={error} onChange={onChange} />;
  }

  return (
    <View>
      <MultiSelectField
        label={label}
        value={selectedLabels}
        options={labels}
        error={error}
        placeholder={field.placeholder ?? `Select ${field.label.toLowerCase()}`}
        searchable={labels.length > 8}
        onChange={(picked) =>
          onChange(
            picked
              .map((l) => options.find((o) => o.label === l)?.value)
              .filter((v): v is string => !!v),
          )
        }
      />
      <Help field={field} />
    </View>
  );
}

/**
 * Free-text list entry for array fields with no enum (`office_items[]`,
 * `cargo_details[]`). The raw text is held locally so a trailing comma survives
 * while the user is still typing the next item; the committed value is always
 * the trimmed, non-empty array.
 */
function FreeTextList({
  field,
  label,
  value,
  error,
  onChange,
}: {
  field: Field;
  label: string;
  value: string[];
  error?: string;
  onChange: (v: FieldValue) => void;
}) {
  const [text, setText] = useState(value.join(', '));

  // Re-sync when the value changes from outside (prefill, step navigation).
  const joined = value.join(', ');
  const [lastJoined, setLastJoined] = useState(joined);
  if (joined !== lastJoined) {
    setLastJoined(joined);
    setText(joined);
  }

  return (
    <View>
      <TextInputField
        label={label}
        value={text}
        error={error}
        placeholder={field.placeholder ?? 'Laptop, printer, air conditioner'}
        onChangeText={(raw) => {
          setText(raw);
          const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
          setLastJoined(items.join(', '));
          onChange(items);
        }}
        multiline
        numberOfLines={2}
      />
      <Help field={field} fallback="Separate each item with a comma." />
    </View>
  );
}

// ── File / image upload ─────────────────────────────────────────────────────
/**
 * File / photo field.
 *
 * These fields are URL-VALUED, not multipart. MyCover fetches and content-checks
 * whatever URL we send (`image_url`, `id_image_url`, `device_about_image_url`)
 * and rejects anything it cannot retrieve as an image — a presigned or private
 * URL fails, a `file://` URI fails, a missing object fails. So picking a file is
 * only step one: we upload it immediately, hold the PUBLIC URL the backend
 * returns, and put THAT in the form.
 *
 * Uploading on pick rather than on submit is deliberate. It means a slow or
 * broken upload surfaces while the user is still looking at the field, instead
 * of failing the whole purchase at the last step.
 */
function UploadControl({
  field,
  label,
  value,
  error,
  onChange,
}: {
  field: Field;
  label: string;
  value: string;
  error?: string;
  onChange: (v: FieldValue) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const isImage = field.type === 'image';
  const hasValue = !!value;

  const store = async (picked: { uri: string; name: string; mimeType?: string }) => {
    setLocalPreview(picked.uri);
    setUploadError(null);
    try {
      const url = await uploadInsuranceFile({ ...picked, purpose: field.name });
      onChange(url);
    } catch (err) {
      setLocalPreview(null);
      onChange('');
      const message = (err as InsuranceError)?.message;
      setUploadError(
        message && (err as InsuranceError)?.status !== 404
          ? message
          : "We couldn't upload that file. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const pickImage = async (fromCamera: boolean) => {
    try {
      setBusy(true);
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        // `alertAsync`, not Alert.alert — the raw one is a silent no-op on
        // react-native-web, which is the build this module is QA'd on.
        await alertAsync({
          title: 'Permission needed',
          message: `Allow access to your ${fromCamera ? 'camera' : 'photos'} to add ${field.label.toLowerCase()}.`,
        });
        setBusy(false);
        return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (result.canceled || !result.assets?.[0]?.uri) {
        setBusy(false);
        return;
      }
      const asset = result.assets[0];
      await store({
        uri: asset.uri,
        name: asset.fileName ?? `${field.name}-${Date.now()}.jpg`,
        mimeType: asset.mimeType,
      });
    } catch {
      setBusy(false);
    }
  };

  const pickDocument = async () => {
    try {
      setBusy(true);
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]?.uri) {
        setBusy(false);
        return;
      }
      const asset = result.assets[0];
      await store({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
    } catch {
      setBusy(false);
    }
  };

  const previewUri = localPreview ?? (hasValue ? value : null);
  const shownError = error ?? uploadError ?? undefined;

  return (
    <View style={styles.uploadWrap}>
      <Text style={styles.uploadLabel}>{label}</Text>

      {previewUri ? (
        <View style={styles.filePreview}>
          {isImage ? (
            <Image source={{ uri: previewUri }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={styles.thumbIcon}>
              <Paperclip size={18} color={InsuranceColors.muted} />
            </View>
          )}
          <View style={styles.grow}>
            <Text style={styles.fileName} numberOfLines={1}>
              {fileNameOf(previewUri)}
            </Text>
            <Text style={styles.fileMeta}>
              {busy ? 'Uploading…' : hasValue ? 'Uploaded' : 'Not uploaded'}
            </Text>
          </View>
          {busy ? (
            <ActivityIndicator size="small" color={InsuranceColors.brand} />
          ) : (
            <Pressable
              onPress={() => {
                setLocalPreview(null);
                setUploadError(null);
                onChange('');
              }}
              hitSlop={10}
              accessibilityLabel={`Remove ${field.label}`}
            >
              <X size={18} color={Colors.onSurfaceVariant} />
            </Pressable>
          )}
        </View>
      ) : (
        <View style={styles.uploadActions}>
          {isImage ? (
            <>
              {Platform.OS !== 'web' ? (
                <Pressable
                  style={[styles.uploadBtn, shownError ? styles.uploadBtnError : null]}
                  onPress={() => pickImage(true)}
                  disabled={busy}
                  accessibilityRole="button"
                >
                  <Camera size={18} color={InsuranceColors.brand} />
                  <Text style={styles.uploadBtnLabel}>Take photo</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.uploadBtn, shownError ? styles.uploadBtnError : null]}
                onPress={() => pickImage(false)}
                disabled={busy}
                accessibilityRole="button"
              >
                <ImagePlus size={18} color={InsuranceColors.brand} />
                <Text style={styles.uploadBtnLabel}>Choose photo</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              style={[styles.uploadBtn, shownError ? styles.uploadBtnError : null]}
              onPress={pickDocument}
              disabled={busy}
              accessibilityRole="button"
            >
              <FileUp size={18} color={InsuranceColors.brand} />
              <Text style={styles.uploadBtnLabel}>Choose file</Text>
            </Pressable>
          )}
        </View>
      )}

      {shownError ? <Text style={styles.error}>{shownError}</Text> : <Help field={field} />}
    </View>
  );
}

function fileNameOf(uri: string): string {
  const clean = String(uri).split('?')[0];
  return clean.split('/').pop() || 'Attached file';
}

// ── Help text ───────────────────────────────────────────────────────────────
/**
 * Below-field guidance. The schema's own `help` wins; otherwise we derive the
 * constraint from the rule the provider will enforce anyway, so a person is told
 * about the ₦5,000 minimum BEFORE the form rejects them for it.
 */
function Help({ field, value, fallback }: { field: Field; value?: string; fallback?: string }) {
  const text = field.help ?? fallback ?? derivedHelp(field, value);
  if (!text) return null;
  return <Text style={styles.help}>{text}</Text>;
}

function derivedHelp(field: Field, value?: string): string | null {
  if (field.type === 'nin') {
    const want = field.maxLength ?? field.minLength ?? 11;
    const typed = (value ?? '').replace(/\D/g, '').length;
    return typed > 0 && typed < want
      ? `${typed} of ${want} digits`
      : `${want} digits, from your National ID slip`;
  }
  if (field.type === 'money') {
    // Bounds are normalised to kobo first — a provider minimum stated in naira
    // (device_value >= 50000 means ₦50,000) must not be shown as ₦500.
    const min = boundInFieldUnits(field, field.min);
    const max = boundInFieldUnits(field, field.max);
    const parts: string[] = [];
    if (min != null) parts.push(`Minimum ${nairaFromKobo(min, { decimals: false })}`);
    if (max != null) parts.push(`maximum ${nairaFromKobo(max, { decimals: false })}`);
    return parts.length ? parts.join(', ') : null;
  }
  if (field.type === 'number') {
    if (field.min != null && field.max != null) return `Between ${field.min} and ${field.max}`;
    if (field.min != null) return `At least ${field.min}`;
    if (field.max != null) return `No more than ${field.max}`;
    return null;
  }
  if (field.minLength != null && field.minLength > 1) {
    return `At least ${field.minLength} characters`;
  }
  return null;
}

// ── Per-type input behaviour ────────────────────────────────────────────────
function sanitizeFor(field: Field, raw: string): string {
  switch (field.type) {
    case 'money':
      return sanitizeMoneyInput(raw);
    case 'number':
      return raw.replace(/[^\d]/g, '');
    case 'nin':
      return raw.replace(/\D/g, '').slice(0, field.maxLength ?? 11);
    case 'phone':
      return raw.replace(/[^\d+\s-]/g, '');
    case 'email':
      return raw.replace(/\s/g, '');
    default:
      return raw;
  }
}

function keyboardFor(field: Field) {
  switch (field.type) {
    case 'email': return 'email-address' as const;
    case 'phone': return 'phone-pad' as const;
    case 'nin':
    case 'number': return 'number-pad' as const;
    case 'money': return 'decimal-pad' as const;
    default: return 'default' as const;
  }
}

function autoCapitalizeFor(field: Field) {
  if (field.type === 'email') return 'none' as const;
  if (field.type === 'text' || field.type === 'address') return 'words' as const;
  return 'none' as const;
}

/**
 * A hard input cap, distinct from validation. Kept slightly above the schema's
 * own maxLength for free text so a user can see and fix an overrun instead of
 * silently losing the character they typed; exact-length fields (NIN) do cap.
 */
function hardMaxLength(field: Field): number | undefined {
  if (field.type === 'nin') return field.maxLength ?? 11;
  if (field.type === 'money') return 13;
  if (field.type === 'phone') return 18;
  if (field.maxLength != null) return field.maxLength + 10;
  return undefined;
}

/** ISO date bound → year, for DatePickerField's wheel range. */
function yearOf(bound: string | undefined): number | undefined {
  if (!bound) return undefined;
  if (bound === 'today') return new Date().getFullYear();
  const t = Date.parse(bound);
  return Number.isFinite(t) ? new Date(t).getFullYear() : undefined;
}

function defaultPlaceholder(field: Field): string | undefined {
  switch (field.type) {
    case 'email': return 'you@example.com';
    case 'phone': return '08031234567';
    case 'nin': return '12345678901';
    case 'money': return '0.00';
    case 'address': return 'Street, area, city';
    default: return undefined;
  }
}

const styles = StyleSheet.create({
  help: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.sm,
    marginLeft: 2,
  },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },

  uploadWrap: { marginBottom: Spacing.md, gap: Spacing.sm },
  uploadLabel: { ...Typography.labelMd, color: Colors.onSurface },
  uploadActions: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: InsuranceColors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    flexGrow: 1,
  },
  uploadBtnError: { borderColor: Colors.error, borderStyle: 'solid' },
  uploadBtnLabel: { ...Typography.labelMd, color: InsuranceColors.brand },
  filePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  thumb: { width: 44, height: 44, borderRadius: Radius.sm, backgroundColor: Colors.surfaceContainerHigh },
  thumbIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileName: { ...Typography.labelMd, color: Colors.onSurface },
  fileMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
  grow: { flex: 1 },

  choiceWrap: { marginBottom: Spacing.md, gap: Spacing.sm },
  choiceRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  choice: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  choiceActive: { borderColor: InsuranceColors.brand, backgroundColor: Colors.iconBgPurple },
  choiceError: { borderColor: Colors.error },
  choiceLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  choiceLabelActive: { color: InsuranceColors.brand, fontWeight: '700' },
});
