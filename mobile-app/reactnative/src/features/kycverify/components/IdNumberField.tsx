import React from 'react';
import TextInputField from '@/components/TextInputField';
import { ID_FORMATS, normalizeIdNumber } from '../idFormats';
import type { IdType } from '../types';

interface Props {
  idType: IdType;
  /** Always the normalized value — the same string the check will submit. */
  value: string;
  onChangeText: (normalized: string) => void;
  error?: string;
  editable?: boolean;
  /** Override the "<label> number" caption where the screen already names the field. */
  label?: string;
}

/**
 * ID-number input bound to Dojah's expected shape for the type: numeric keypad
 * and a hard max for BVN/NIN, alphanumeric uppercase for passport/licence/VIN.
 * Callers hold the normalized value, so what is displayed is what is submitted.
 */
export default function IdNumberField({ idType, value, onChangeText, error, editable = true, label }: Props) {
  const format = ID_FORMATS[idType];
  return (
    <TextInputField
      label={label ?? `${format.label} number`}
      value={value}
      onChangeText={(raw) => onChangeText(normalizeIdNumber(idType, raw))}
      placeholder={format.placeholder}
      keyboardType={format.keyboard}
      autoCapitalize="characters"
      autoCorrect={false}
      maxLength={format.maxLength}
      editable={editable}
      error={error}
    />
  );
}
