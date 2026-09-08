import React, { useMemo, useRef, useState } from 'react';
import {
  View, TextInput, Text, Pressable, Modal, FlatList, StyleSheet,
} from 'react-native';
import { ChevronDown, Smartphone, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import {
  COUNTRIES, DEFAULT_COUNTRY, countryByIso2, formatNsn, isValid,
  placeholderFor, toE164, toNsn, type Country,
} from '@/lib/phone/phone';

export interface PhoneNumberInputProps {
  label?: string;
  /** National number, in any shape the user or an API produced. */
  value: string;
  /**
   * Fires with the SANITISED value on every keystroke:
   *   nsn   — bare national number, digits only ("8012345678")
   *   e164  — "+2348012345678", or "" while incomplete
   *   valid — whether the number is complete for the selected country
   * Store `e164` and you never send a formatted string to an API again.
   */
  onChange: (next: { nsn: string; e164: string; valid: boolean; country: Country }) => void;
  error?: string;
  editable?: boolean;
  defaultIso2?: string;
  /**
   * Restrict to countries usable as a SIGN-IN identifier. The backend reduces
   * every identifier to a 10-digit Nigerian national number, so a number from
   * anywhere else cannot be resolved at sign-in and would collide with the
   * Nigerian subscriber holding the same digits. Default true — opt OUT only for
   * contact fields (next of kin, a delivery contact) that are never an identity.
   */
  identityOnly?: boolean;
  testID?: string;
}

export default function PhoneNumberInput({
  label, value, onChange, error, editable = true,
  defaultIso2 = DEFAULT_COUNTRY.iso2, identityOnly = true, testID,
}: PhoneNumberInputProps) {
  const options = useMemo(
    () => (identityOnly ? COUNTRIES.filter((c) => c.identity) : COUNTRIES),
    [identityOnly],
  );
  const [country, setCountry] = useState<Country>(() => {
    const wanted = countryByIso2(defaultIso2);
    return options.some((c) => c.iso2 === wanted.iso2) ? wanted : options[0];
  });
  const [focused, setFocused] = useState(false);
  const [picking, setPicking] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const nsn = toNsn(value, country);
  const display = formatNsn(nsn, country);

  const emit = (raw: string, c: Country) => {
    const cleanNsn = toNsn(raw, c);
    onChange({
      nsn: cleanNsn,
      e164: toE164(cleanNsn, c),
      valid: isValid(cleanNsn, c),
      country: c,
    });
  };

  const pick = (c: Country) => {
    setCountry(c);
    setPicking(false);
    emit(nsn, c); // re-validate against the new country's length
  };

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <Pressable
        style={[styles.container, focused && styles.focused, !!error && styles.errored,
                !editable && styles.disabled]}
        onPress={() => inputRef.current?.focus()}
        disabled={!editable}
      >
        <Pressable
          style={styles.country}
          onPress={() => options.length > 1 && setPicking(true)}
          disabled={!editable || options.length < 2}
          accessibilityRole="button"
          accessibilityLabel={`Country code ${country.dial}`}
          testID={testID ? `${testID}-country` : undefined}
        >
          <Text style={styles.flag}>{country.flag}</Text>
          {options.length > 1 ? <ChevronDown size={16} color={Colors.outline} /> : null}
        </Pressable>

        <Text style={styles.dial}>{country.dial}</Text>

        <TextInput
          ref={inputRef}
          value={display}
          onChangeText={(t) => emit(t, country)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={editable}
          keyboardType="phone-pad"
          inputMode="tel"
          textContentType="telephoneNumber"
          autoComplete="tel"
          // Grouping adds two spaces; the cap is enforced in toNsn regardless.
          maxLength={country.nsnLen + 3}
          placeholder={placeholderFor(country)}
          placeholderTextColor={Colors.outline}
          style={styles.input}
          testID={testID}
        />

        <Smartphone size={18} color={Colors.outline} strokeWidth={1.8} />
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={picking} transparent animationType="fade"
             onRequestClose={() => setPicking(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPicking(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Select country</Text>
            <FlatList
              data={options}
              keyExtractor={(c) => c.iso2}
              renderItem={({ item }) => (
                <Pressable style={styles.row} onPress={() => pick(item)}>
                  <Text style={styles.flag}>{item.flag}</Text>
                  <Text style={styles.rowName}>{item.name}</Text>
                  <Text style={styles.rowDial}>{item.dial}</Text>
                  {item.iso2 === country.iso2
                    ? <Check size={16} color={Colors.primary} />
                    : null}
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:   { marginBottom: Spacing.md },
  label:     { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  // Mirrors TextInputField exactly (height 56, 1.5 border, same containers) so a
  // phone field sits flush with every other field on the same form.
  container: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.transparent,
    height: 56, paddingHorizontal: Spacing.md,
  },
  focused:   { borderColor: Colors.secondary, backgroundColor: Colors.surfaceContainerLowest },
  errored:   { borderColor: Colors.error },
  disabled:  { opacity: 0.6 },
  country:   { flexDirection: 'row', alignItems: 'center', gap: 2 },
  flag:      { fontSize: 20 },
  dial:      { ...Typography.bodyMd, color: Colors.onSurface },
  input:     { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, padding: 0 },
  error:     { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  backdrop:  { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  sheet:     {
    backgroundColor: Colors.surface, borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl, padding: Spacing.lg, maxHeight: '60%',
  },
  sheetTitle:{ ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.md },
  row:       {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  rowName:   { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  rowDial:   { ...Typography.bodyMd, color: Colors.outline },
});
