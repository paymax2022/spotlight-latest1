// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createAccessCode } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function WalkInScreen() {
  const router = useRouter();
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [purpose, setPurpose] = useState('');

  // Walk-in creates a one-time pass valid for 2 hours on behalf of the guard.
  const mutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      const now = new Date();
      const validUntil = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      return createAccessCode(ctx.estateId, {
        visitor_name: visitorName.trim(),
        visitor_phone: visitorPhone || undefined,
        vehicle_plate: vehiclePlate || undefined,
        purpose: purpose || 'Walk-in visit',
        code_type: 'one_time',
        valid_from: now.toISOString(),
        valid_until: validUntil.toISOString(),
        max_uses: 1,
      });
    },
    onSuccess: (code) => {
      Alert.alert(
        'Walk-In Pass Created',
        `Code: ${code.numeric_code}\nValid for 2 hours.`,
        [{ text: 'OK', onPress: () => router.replace({ pathname: '/estate/guard/visitor-confirm', params: { codeId: code.id } } as never) }]
      );
    },
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Could not create walk-in pass'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Ionicons name="walk-outline" size={32} color="#10B981" />
          <View>
            <Text style={styles.heading}>Walk-In Request</Text>
            <Text style={styles.sub}>Creates a one-time pass valid for 2 hours.</Text>
          </View>
        </View>

        <Text style={styles.label}>Visitor Name *</Text>
        <TextInput style={styles.input} value={visitorName} onChangeText={setVisitorName} placeholder="Full name" placeholderTextColor={colors.neutral.placeholder} />

        <Text style={styles.label}>Phone Number</Text>
        <TextInput style={styles.input} value={visitorPhone} onChangeText={setVisitorPhone} placeholder="+234 800…" placeholderTextColor={colors.neutral.placeholder} keyboardType="phone-pad" />

        <Text style={styles.label}>Vehicle Plate (optional)</Text>
        <TextInput style={styles.input} value={vehiclePlate} onChangeText={(v) => setVehiclePlate(v.toUpperCase())} placeholder="LAS-123-AA" placeholderTextColor={colors.neutral.placeholder} autoCapitalize="characters" />

        <Text style={styles.label}>Purpose</Text>
        <TextInput style={styles.input} value={purpose} onChangeText={setPurpose} placeholder="Reason for visit" placeholderTextColor={colors.neutral.placeholder} />

        <View style={styles.noteBox}>
          <Ionicons name="information-circle-outline" size={16} color="#F59E0B" />
          <Text style={styles.noteText}>
            You are creating this pass on behalf of the resident. Ensure you have verbal confirmation before granting entry.
          </Text>
        </View>

        <Pressable
          style={[styles.submitBtn, (!visitorName || mutation.isPending) && styles.disabled]}
          onPress={() => mutation.mutate()}
          disabled={!visitorName || mutation.isPending}
        >
          {mutation.isPending ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="add-circle-outline" size={20} color="#fff" />
              <Text style={styles.submitBtnText}>Create Walk-In Pass</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  scroll: { padding: 20, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  heading: { fontSize: 20, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 13, color: colors.neutral.textMuted },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted, marginTop: 4 },
  input: { backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: '#E2E8F0' },
  noteBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FFFBEB', borderRadius: 10, padding: 12 },
  noteText: { flex: 1, fontSize: 12, color: '#D97706', lineHeight: 18 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#10B981', borderRadius: 14, paddingVertical: 16, marginTop: 8 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.5 },
});
