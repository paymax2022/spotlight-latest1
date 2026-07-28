import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Search, Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { searchDiagnosisCodes } from '@/features/doctor/hooks';
import { ICD_CODES } from '@/features/doctor/constants';
import type { DiagnosisCode } from '@/types/doctor.batch2';

interface Props {
  visible:   boolean;
  selected:  DiagnosisCode[];
  onClose:   () => void;
  onToggle:  (code: DiagnosisCode) => void;
}

// New component: a searchable, multi-select ICD-code picker sheet. SelectField
// only handles a single-string flat list with single selection; the diagnosis
// picker needs code + label + category rows, multi-select with running ticks,
// and the pure searchDiagnosisCodes() helper, so a dedicated sheet is justified.
// Reuses the Modal/sheet pattern from reviews/index.
export default function DiagnosisSearchSheet({ visible, selected, onClose, onToggle }: Props) {
  const [query, setQuery] = useState('');

  const results = useMemo<DiagnosisCode[]>(
    () => (query.trim() ? searchDiagnosisCodes(query) : ICD_CODES),
    [query],
  );
  const selectedCodes = useMemo(() => new Set(selected.map((c) => c.code)), [selected]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Search diagnosis (ICD)</Text>
            <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close diagnosis search">
              <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
            </Pressable>
          </View>

          <View style={styles.searchBox}>
            <Search size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by code or condition"
              placeholderTextColor={Colors.outline}
              value={query}
              onChangeText={setQuery}
              autoFocus
            />
          </View>

          <FlatList
            data={results}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>No matching diagnosis codes.</Text>}
            renderItem={({ item }) => {
              const on = selectedCodes.has(item.code);
              return (
                <Pressable
                  style={styles.row}
                  onPress={() => onToggle(item)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${item.code} ${item.label}`}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.rowLabel} numberOfLines={1}>{item.label}</Text>
                    <Text style={styles.rowMeta}>{item.code} · {item.category}</Text>
                  </View>
                  <View style={[styles.check, on && styles.checkOn]}>
                    {on && <Check size={13} color={Colors.onPrimary} strokeWidth={3} />}
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '80%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  searchBox:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, height: 48, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, marginBottom: Spacing.sm },
  searchInput: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface },
  list:        { marginTop: Spacing.xs },
  empty:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', paddingVertical: Spacing.lg },
  row:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowBody:     { flex: 1, gap: 2 },
  rowLabel:    { ...Typography.labelMd, color: Colors.onSurface },
  rowMeta:     { ...Typography.caption, color: Colors.onSurfaceVariant },
  check:       { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  checkOn:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
});
