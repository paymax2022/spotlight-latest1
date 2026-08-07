import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  FlatList,
  TextInput,
  StyleSheet,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { ChevronDown, Check, Search, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';

interface MultiSelectFieldProps {
  label?: string;
  placeholder?: string;
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
  error?: string;
  disabled?: boolean;
  searchable?: boolean;
}

/**
 * Multi-select counterpart to SelectField. Opens a bottom sheet of checkable
 * options and surfaces the current selection as chips on the trigger. Backed by
 * a `string[]` value + `onChange(string[])`.
 */
export default function MultiSelectField({
  label,
  placeholder = 'Select options',
  value,
  options,
  onChange,
  error,
  disabled = false,
  searchable = true,
}: MultiSelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (item: string) => {
    if (value.includes(item)) {
      onChange(value.filter((v) => v !== item));
    } else {
      onChange([...value, item]);
    }
  };

  const removeChip = (item: string) => onChange(value.filter((v) => v !== item));

  const close = () => { setOpen(false); setQuery(''); };

  const screenHeight = Dimensions.get('window').height;

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={[
          styles.trigger,
          value.length > 0 && styles.triggerFilled,
          !!error && styles.triggerError,
          disabled && styles.triggerDisabled,
        ]}
      >
        {value.length === 0 ? (
          <Text style={[styles.triggerText, styles.triggerPlaceholder]} numberOfLines={1}>
            {placeholder}
          </Text>
        ) : (
          <View style={styles.chipRow}>
            {value.map((v) => (
              <View key={v} style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>{v}</Text>
                <Pressable
                  onPress={() => removeChip(v)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <X size={12} color={Colors.primary} strokeWidth={2.5} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <ChevronDown size={18} color={Colors.outline} strokeWidth={2} />
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <Pressable style={styles.backdrop} onPress={close} />
          <View style={[styles.sheet, { maxHeight: screenHeight * 0.72 }]}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label ?? 'Select'}</Text>
              <Pressable onPress={close} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
              </Pressable>
            </View>

            {searchable && (
              <View style={styles.searchWrap}>
                <Search size={16} color={Colors.outline} strokeWidth={2} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search…"
                  placeholderTextColor={Colors.outline}
                  value={query}
                  onChangeText={setQuery}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {query.length > 0 && (
                  <Pressable onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <X size={14} color={Colors.outline} strokeWidth={2} />
                  </Pressable>
                )}
              </View>
            )}

            <FlatList
              data={filtered}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const selected = value.includes(item);
                return (
                  <Pressable
                    onPress={() => toggle(item)}
                    style={[styles.option, selected && styles.optionSelected]}
                  >
                    <View style={[styles.checkbox, selected && styles.checkboxOn]}>
                      {selected && <Check size={13} color={Colors.onPrimary ?? '#fff'} strokeWidth={3} />}
                    </View>
                    <Text
                      style={[styles.optionText, selected && styles.optionTextSelected]}
                      numberOfLines={1}
                    >
                      {item}
                    </Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={<Text style={styles.emptyText}>No results for "{query}"</Text>}
            />

            <View style={styles.footer}>
              <Pressable onPress={close} style={styles.doneBtn}>
                <Text style={styles.doneText}>
                  {value.length > 0 ? `Done (${value.length} selected)` : 'Done'}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  wrapper: { marginBottom: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.transparent,
    minHeight: 56,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  triggerFilled: { alignItems: 'flex-start' },
  triggerError: { borderColor: Colors.error },
  triggerDisabled: { opacity: 0.5 },
  triggerText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, marginRight: Spacing.sm },
  triggerPlaceholder: { color: Colors.outline },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, flex: 1, marginRight: Spacing.sm, paddingVertical: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryFixed,
    borderRadius: Radius.full,
    paddingLeft: Spacing.sm,
    paddingRight: 6,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  chipText: { ...Typography.labelSm, color: Colors.primary, flexShrink: 1 },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingBottom: 40,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceContainerHigh,
    alignSelf: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  sheetTitle: { ...Typography.titleMd, color: Colors.onSurface },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    height: 48,
  },
  searchInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface, padding: 0 },
  listContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceContainerLow,
  },
  optionSelected: { backgroundColor: Colors.primaryFixed, marginHorizontal: -Spacing.md, paddingHorizontal: Spacing.md, borderRadius: Radius.md },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  optionText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, marginRight: Spacing.sm },
  optionTextSelected: { color: Colors.primary, fontWeight: '700' },
  emptyText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.xl },
  footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  doneBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { ...Typography.labelLg, color: Colors.onPrimary ?? '#fff', fontWeight: '700' },
});
