// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function DocumentRestrictedScreen() {
  const router = useRouter();
  const { documentId } = useLocalSearchParams();
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/documents/${documentId}/request-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => Alert.alert('Requested', 'Access request submitted. Admin will review shortly.', [{ text: 'OK', onPress: () => router.back() }]),
    onError: () => Alert.alert('Error', 'Request failed.'),
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Restricted Document</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.lockCard}>
          <Ionicons name="lock-closed" size={60} color="#7c3aed" />
          <Text style={s.lockTitle}>Access Restricted</Text>
          <Text style={s.lockSub}>This document requires admin clearance to view or download.</Text>
        </View>

        <Text style={s.label}>Reason for Access Request</Text>
        <TextInput
          style={[s.input, { height: 100, textAlignVertical: 'top' }]}
          placeholder="Explain why you need access to this document..."
          placeholderTextColor={colors.neutral.placeholder}
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={4}
        />

        <Pressable style={[s.submitBtn, (!reason.trim() || mutation.isPending) && { opacity: 0.5 }]} onPress={() => mutation.mutate()} disabled={!reason.trim() || mutation.isPending}>
          <Text style={s.submitBtnTxt}>{mutation.isPending ? 'Requesting…' : 'Request Access'}</Text>
        </Pressable>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backBtnTxt}>Go Back</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  lockCard: { backgroundColor: colors.neutral.surface, borderRadius: 20, padding: 28, alignItems: 'center', gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  lockTitle: { fontSize: 22, fontWeight: '800', color: colors.neutral.text },
  lockSub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 22 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  submitBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  submitBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  backBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.neutral.border },
  backBtnTxt: { color: colors.neutral.text, fontSize: 16, fontWeight: '600' },
});
