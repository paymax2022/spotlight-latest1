// @ts-nocheck
// Add a new property / unit to the estate (admin only)
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { addProperty } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const PROPERTY_TYPES = ['apartment', 'house', 'commercial', 'land', 'other'];

export default function AddPropertyScreen() {
  const router = useRouter();
  const { estateId: estateIdParam } = useLocalSearchParams<{ estateId?: string }>();
  const queryClient = useQueryClient();
  const [unitLabel, setUnitLabel] = useState('');
  const [propertyType, setPropertyType] = useState('apartment');
  const [floor, setFloor] = useState('');
  const [block, setBlock] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeContext = useQuery({
    queryKey: ['active-estate-context'],
    queryFn: getActiveEstateContext,
  });
  const estateId = estateIdParam ?? activeContext.data?.estateId;

  const addMutation = useMutation({
    mutationFn: () =>
      addProperty(estateId!, {
        unit_label: unitLabel.trim(),
        property_type: propertyType,
        floor: floor.trim() || undefined,
        block: block.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estate-properties', estateId] });
      router.back();
    },
    onError: (err: { response?: { data?: { error?: string } } }) =>
      setError(err?.response?.data?.error || 'Could not add property. You may not have admin access.'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Add Property</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.label}>Unit Label *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Flat 4B, House 12, Shop 3"
          placeholderTextColor={colors.neutral.placeholder}
          value={unitLabel}
          onChangeText={setUnitLabel}
        />

        <Text style={styles.label}>Property Type *</Text>
        <View style={styles.typeRow}>
          {PROPERTY_TYPES.map((t) => (
            <Pressable
              key={t}
              style={[styles.typeChip, propertyType === t && styles.typeChipActive]}
              onPress={() => setPropertyType(t)}
            >
              <Text style={[styles.typeChipText, propertyType === t && styles.typeChipTextActive]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Block (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Block A"
          placeholderTextColor={colors.neutral.placeholder}
          value={block}
          onChangeText={setBlock}
        />

        <Text style={styles.label}>Floor (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Ground, 1st, 2nd"
          placeholderTextColor={colors.neutral.placeholder}
          value={floor}
          onChangeText={setFloor}
        />

        <Pressable
          style={[styles.primaryBtn, (!unitLabel.trim() || addMutation.isPending) && styles.primaryBtnDisabled]}
          disabled={!unitLabel.trim() || addMutation.isPending}
          onPress={() => {
            if (!estateId) {
              setError('Choose an estate before adding a property.');
              return;
            }
            setError(null);
            addMutation.mutate();
          }}
        >
          {addMutation.isPending
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryBtnText}>Add Property</Text>
          }
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#FEE2E2', padding: 12, borderRadius: 10 },
  errorText: { color: '#dc2626', fontSize: 13, flex: 1 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: {
    backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14,
    fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border,
  },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: colors.neutral.surfaceAlt, borderWidth: 1, borderColor: colors.neutral.border,
  },
  typeChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  typeChipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  typeChipTextActive: { color: '#fff' },
  primaryBtn: {
    backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 54,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
