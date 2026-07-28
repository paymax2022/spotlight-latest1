// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createAccessCode, type CodeType } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const CODE_TYPES: { type: CodeType; label: string; icon: string; color: string }[] = [
  { type: 'one_time', label: 'One Time', icon: 'person-outline', color: '#6C63FF' },
  { type: 'multi_day', label: 'Multi Day', icon: 'calendar-outline', color: '#3B82F6' },
  { type: 'recurring', label: 'Recurring', icon: 'repeat-outline', color: '#10B981' },
  { type: 'delivery', label: 'Delivery', icon: 'cube-outline', color: '#F59E0B' },
  { type: 'ridehailing', label: 'Ride', icon: 'car-outline', color: '#8B5CF6' },
  { type: 'staff', label: 'Staff', icon: 'briefcase-outline', color: '#EF4444' },
  { type: 'contractor', label: 'Contractor', icon: 'construct-outline', color: '#06B6D4' },
  { type: 'family', label: 'Family', icon: 'people-outline', color: '#EC4899' },
];

function toISOLocal(date: Date) {
  return date.toISOString();
}

function addHours(h: number) {
  const d = new Date();
  d.setHours(d.getHours() + h);
  return toISOLocal(d);
}

function addDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(23, 59, 0, 0);
  return toISOLocal(d);
}

export default function CreateAccessCodeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ codeType?: string }>();

  const [codeType, setCodeType] = useState<CodeType>((params.codeType as CodeType) ?? 'one_time');
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [purpose, setPurpose] = useState('');
  const [validUntil, setValidUntil] = useState(addHours(6)); // default 6 h

  const mutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return createAccessCode(ctx.estateId, {
        visitor_name: visitorName.trim(),
        visitor_phone: visitorPhone || undefined,
        vehicle_plate: vehiclePlate || undefined,
        purpose: purpose || undefined,
        code_type: codeType,
        valid_from: new Date().toISOString(),
        valid_until: validUntil,
        max_uses: codeType === 'one_time' ? 1 : 10,
      });
    },
    onSuccess: (code) => {
      queryClient.invalidateQueries({ queryKey: ['access-codes'] });
      router.replace({ pathname: '/estate/visitors/code', params: { codeId: code.id } } as never);
    },
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Failed to create code'),
  });

  const selectedType = CODE_TYPES.find((c) => c.type === codeType)!;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Create Access Code</Text>

        {/* Code type selector */}
        <Text style={styles.label}>Access Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll}>
          <View style={styles.typeRow}>
            {CODE_TYPES.map((ct) => (
              <Pressable
                key={ct.type}
                style={[styles.typeChip, codeType === ct.type && { backgroundColor: ct.color, borderColor: ct.color }]}
                onPress={() => setCodeType(ct.type)}
              >
                <Ionicons name={ct.icon as any} size={16} color={codeType === ct.type ? '#fff' : ct.color} />
                <Text style={[styles.typeChipText, codeType === ct.type && { color: '#fff' }]}>{ct.label}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        {/* Visitor details */}
        <Text style={styles.label}>Visitor Name *</Text>
        <TextInput style={styles.input} value={visitorName} onChangeText={setVisitorName} placeholder="Full name" placeholderTextColor={colors.neutral.placeholder} />

        <Text style={styles.label}>Phone Number</Text>
        <TextInput style={styles.input} value={visitorPhone} onChangeText={setVisitorPhone} placeholder="+234 800…" placeholderTextColor={colors.neutral.placeholder} keyboardType="phone-pad" />

        <Text style={styles.label}>Vehicle Plate (optional)</Text>
        <TextInput style={styles.input} value={vehiclePlate} onChangeText={(v) => setVehiclePlate(v.toUpperCase())} placeholder="LAS-123-AA" placeholderTextColor={colors.neutral.placeholder} autoCapitalize="characters" />

        <Text style={styles.label}>Purpose</Text>
        <TextInput style={styles.input} value={purpose} onChangeText={setPurpose} placeholder="e.g. Social visit, Package delivery" placeholderTextColor={colors.neutral.placeholder} />

        {/* Expiry presets */}
        <Text style={styles.label}>Valid Until</Text>
        <View style={styles.expiryRow}>
          {[
            { label: '3 h', fn: () => setValidUntil(addHours(3)) },
            { label: '6 h', fn: () => setValidUntil(addHours(6)) },
            { label: '1 d', fn: () => setValidUntil(addDays(1)) },
            { label: '3 d', fn: () => setValidUntil(addDays(3)) },
            { label: '1 w', fn: () => setValidUntil(addDays(7)) },
          ].map((p) => (
            <Pressable key={p.label} style={styles.expiryChip} onPress={p.fn}>
              <Text style={styles.expiryChipText}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.expiryValue}>Expires: {new Date(validUntil).toLocaleString('en-NG')}</Text>

        {/* Review card */}
        <View style={[styles.reviewCard, { borderColor: selectedType.color }]}>
          <View style={[styles.reviewIcon, { backgroundColor: selectedType.color + '18' }]}>
            <Ionicons name={selectedType.icon as any} size={24} color={selectedType.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.reviewType}>{selectedType.label} Pass</Text>
            <Text style={styles.reviewName}>{visitorName || '—'}</Text>
          </View>
        </View>

        <Pressable
          style={[styles.submitBtn, { backgroundColor: selectedType.color }, (!visitorName || mutation.isPending) && styles.disabled]}
          onPress={() => mutation.mutate()}
          disabled={!visitorName || mutation.isPending}
        >
          {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Generate Code</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  scroll: { padding: 20, gap: 10 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text, marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted, marginTop: 6 },
  input: { backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: '#E2E8F0' },
  typeScroll: { marginHorizontal: -20, paddingHorizontal: 20 },
  typeRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F1F5F9', borderWidth: 1.5, borderColor: '#E2E8F0' },
  typeChipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  expiryRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  expiryChip: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#F1F5F9', borderRadius: 10 },
  expiryChipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  expiryValue: { fontSize: 12, color: colors.neutral.textMuted },
  reviewCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1.5, marginTop: 4 },
  reviewIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  reviewType: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  reviewName: { fontSize: 15, fontWeight: '800', color: colors.neutral.text },
  submitBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  disabled: { opacity: 0.5 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
