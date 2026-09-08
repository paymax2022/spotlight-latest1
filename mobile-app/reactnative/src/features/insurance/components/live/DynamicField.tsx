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
import { Camera, FileUp, ImagePlus, Paperclip, Plus, Trash2, X } from 'lucide-react-native';
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
import {
  asGroup,
  asList,
  asRows,
  asText,
  boundInFieldUnits,
  optionsQueryFor,
} from '../../live/formEngine';
import { useFieldOptions } from '../../live/hooks';
import { nairaFromKobo } from '../../live/money';
import type { Field, FieldValue, FormValues, InsuranceError } from '../../live/types';

const YES_NO: Field['options'] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

export default function DynamicField({
  field,
  value,
  error,
  onChange,
  productCode,
  values,
}: {
  field: Field;
  value: FieldValue | undefined;
  error?: string;
  onChange: (v: FieldValue) => void;
  /** Needed to resolve utility-backed dropdown options server-side. */
  productCode: string;
  /** The sibling answers — dependent dropdowns are filtered by their parent. */
  values: FormValues;
}) {
  const label = field.required ? field.label : `${field.label} (optional)`;

  // Options fetched from a lookup rather than declared inline (109 vehicle
  // makes, 193 nationalities, the LGAs of one state).
  if (field.remoteOptions && (field.type === 'select' || field.type === 'multiselect')) {
    return (
      <RemoteOptionsControl
        field={field}
        label={label}
        value={value}
        error={error}
        onChange={onChange}
        productCode={productCode}
        values={values}
      />
    );
  }

  switch (field.type) {
    case 'object':
      return (
        <GroupControl
          field={field}
          value={asGroup(value)}
          error={error}
          onChange={onChange}
          productCode={productCode}
        />
      );

    case 'array':
      return (
        <RepeatingControl
          field={field}
          rows={asRows(value)}
          error={error}
          onChange={onChange}
          productCode={productCode}
        />
      );

    case 'boolean':
      return (
        <ChoiceRow
          field={{ ...field, options: YES_NO }}
          label={label}
          value={asText(value)}
          error={error}
          onChange={onChange}
        />
      );

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


// ── Remote-option dropdowns ─────────────────────────────────────────────────
/**
 * A dropdown whose options come from a lookup, including the dependent ones.
 *
 * The dependency is the whole point. `vehicle_model` returns an EMPTY list when
 * fetched without its parent make, and `lga` shares one lookup with `state`
 * (no query = the 36 states; `?query=Abia` = that state's LGAs). Fetching
 * eagerly therefore produces a dropdown that opens onto nothing and cannot be
 * completed — so until the parent is answered we do not fetch at all, and say
 * what is needed instead.
 */
function RemoteOptionsControl({
  field,
  label,
  value,
  error,
  onChange,
  productCode,
  values,
}: {
  field: Field;
  label: string;
  value: FieldValue | undefined;
  error?: string;
  onChange: (v: FieldValue) => void;
  productCode: string;
  values: FormValues;
}) {
  const query = optionsQueryFor(field, values);
  const waitingOnParent = query === '';
  const options = useFieldOptions({
    productCode,
    field: field.name,
    enabled: !waitingOnParent,
    query,
  });

  const parentLabel = field.dependsOn?.field
    ? humanizeFieldName(field.dependsOn.field)
    : 'the previous answer';

  if (waitingOnParent) {
    return (
      <View style={styles.lockedWrap}>
        <Text style={styles.uploadLabel}>{label}</Text>
        <View style={styles.locked}>
          <Text style={styles.lockedText}>Choose {parentLabel} first</Text>
        </View>
      </View>
    );
  }

  if (options.isLoading) {
    return (
      <View style={styles.lockedWrap}>
        <Text style={styles.uploadLabel}>{label}</Text>
        <View style={styles.locked}>
          <ActivityIndicator size="small" color={InsuranceColors.brand} />
          <Text style={styles.lockedText}>Loading options…</Text>
        </View>
      </View>
    );
  }

  if (options.isError) {
    return (
      <View style={styles.lockedWrap}>
        <Text style={styles.uploadLabel}>{label}</Text>
        <Pressable style={[styles.locked, styles.lockedError]} onPress={() => options.refetch()}>
          <Text style={styles.lockedErrorText}>Couldn&apos;t load the options — tap to retry</Text>
        </Pressable>
      </View>
    );
  }

  const loaded = options.data ?? [];
  if (loaded.length === 0) {
    return (
      <View style={styles.lockedWrap}>
        <Text style={styles.uploadLabel}>{label}</Text>
        <View style={styles.locked}>
          <Text style={styles.lockedText}>
            The insurer has no options here for {query ? `“${query}”` : 'this plan'} yet.
          </Text>
        </View>
      </View>
    );
  }

  const resolved: Field = { ...field, options: loaded, remoteOptions: false };
  return field.type === 'multiselect' ? (
    <MultiSelectControl
      field={resolved}
      label={label}
      value={asList(value)}
      error={error}
      onChange={onChange}
    />
  ) : (
    <SelectControl
      field={resolved}
      label={label}
      value={asText(value)}
      error={error}
      onChange={onChange}
    />
  );
}

function humanizeFieldName(name: string): string {
  return String(name).replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

// ── Nested object block ─────────────────────────────────────────────────────
/**
 * A nested block of fields — `policy_holder` appears on roughly 65 of the 69
 * products. It is drawn as a titled card of its own children so a person can
 * see that these answers are about one subject, and its value stays a nested
 * object so the payload keeps the shape the insurer expects.
 */
function GroupControl({
  field,
  value,
  error,
  onChange,
  productCode,
}: {
  field: Field;
  value: FormValues;
  error?: string;
  onChange: (v: FieldValue) => void;
  productCode: string;
}) {
  const children = field.children ?? [];
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{field.label}</Text>
      {field.help ? <Text style={styles.groupHelp}>{field.help}</Text> : null}
      {children.map((child) => (
        <DynamicField
          key={child.name}
          field={child}
          value={value[child.name]}
          error={error && children.length === 1 ? error : undefined}
          productCode={productCode}
          values={value}
          onChange={(v) => onChange({ ...value, [child.name]: v })}
        />
      ))}
      {error && children.length !== 1 ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

// ── Repeating group ─────────────────────────────────────────────────────────
/**
 * A repeating group — `office_items[]`, `cargo_details[]`, `beneficiaries[]`.
 * 17 products carry one.
 *
 * Each row is the child schema rendered again, and rows can be added and
 * removed. The first row is created automatically for a required field: an
 * empty list with an "Add" button reads as optional, and the user finds out
 * otherwise only when the step refuses to advance.
 */
function RepeatingControl({
  field,
  rows,
  error,
  onChange,
  productCode,
}: {
  field: Field;
  rows: FormValues[];
  error?: string;
  onChange: (v: FieldValue) => void;
  productCode: string;
}) {
  const children = field.children ?? [];
  const minRows = field.minRows ?? (field.required ? 1 : 0);
  const effective = rows.length === 0 && minRows > 0 ? [{}] : rows;
  const atMax = field.maxRows != null && effective.length >= field.maxRows;

  const setRow = (index: number, next: FormValues) =>
    onChange(effective.map((r, i) => (i === index ? next : r)));

  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{field.label}</Text>
      {field.help ? <Text style={styles.groupHelp}>{field.help}</Text> : null}

      {effective.map((row, index) => (
        <View key={index} style={styles.row}>
          <View style={styles.rowHead}>
            <Text style={styles.rowTitle}>
              {singularLabel(field.label)} {index + 1}
            </Text>
            {effective.length > minRows ? (
              <Pressable
                onPress={() => onChange(effective.filter((_, i) => i !== index))}
                hitSlop={10}
                accessibilityLabel={`Remove ${singularLabel(field.label)} ${index + 1}`}
              >
                <Trash2 size={16} color={Colors.error} />
              </Pressable>
            ) : null}
          </View>
          {children.map((child) => (
            <DynamicField
              key={child.name}
              field={child}
              value={row[child.name]}
              productCode={productCode}
              values={row}
              onChange={(v) => setRow(index, { ...row, [child.name]: v })}
            />
          ))}
        </View>
      ))}

      {atMax ? null : (
        <Pressable
          style={styles.addRow}
          onPress={() => onChange([...effective, {}])}
          accessibilityRole="button"
        >
          <Plus size={16} color={InsuranceColors.brand} />
          <Text style={styles.addRowLabel}>Add another {singularLabel(field.label).toLowerCase()}</Text>
        </Pressable>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function singularLabel(label: string): string {
  const l = String(label).trim();
  if (/ies$/i.test(l)) return `${l.slice(0, -3)}y`;
  if (/s$/i.test(l) && !/ss$/i.test(l)) return l.slice(0, -1);
  return l;
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

  lockedWrap: { marginBottom: Spacing.md, gap: Spacing.sm },
  locked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: InsuranceColors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow,
  },
  lockedError: { borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  lockedText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  lockedErrorText: { ...Typography.labelMd, color: Colors.error },

  group: {
    marginBottom: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceContainerLow,
    gap: Spacing.xs,
  },
  groupTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  groupHelp: {
    ...Typography.labelSm,
    color: Colors.onSurfaceVariant,
    marginTop: -Spacing.xs,
    marginBottom: Spacing.sm,
  },
  row: {
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceContainerLowest,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  rowTitle: { ...Typography.labelLg, color: Colors.onSurface },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: InsuranceColors.border,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
  },
  addRowLabel: { ...Typography.labelMd, color: InsuranceColors.brand },
});
