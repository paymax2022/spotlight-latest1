// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const EMERGENCIES = ['Cardiac', 'Stroke', 'Injury', 'Respiratory', 'Other'];

export default function MedicalEmergencyScreen() {
  const router = useRouter();
  const [location, setLocation] = useState('');
  const [patient, setPatient] = useState('');
  const [nature, setNature] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/emergency/medical', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location, patient_description: patient, nature }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      setShowConfirm(false);
      Alert.alert('Alert Sent', 'Medical alert dispatched. Help is on the way.', [
        { text: 'OK', onPress: () => router.replace('/emergency' as never) },
      ]);
    },
    onError: () => { setShowConfirm(false); Alert.alert('Error', 'Failed to send alert.'); },
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Medical Emergency</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.alertBanner}>
          <Ionicons name="medkit" size={24} color="#fff" />
          <Text style={s.alertBannerTxt}>This will alert estate medical response team immediately.</Text>
        </View>

        <Text style={s.label}>Location</Text>
        <TextInput style={s.input} placeholder="Unit/Block/Common area" placeholderTextColor={colors.neutral.placeholder} value={location} onChangeText={setLocation} />

        <Text style={s.label}>Patient Description</Text>
        <TextInput style={s.input} placeholder="Age, gender, condition..." placeholderTextColor={colors.neutral.placeholder} value={patient} onChangeText={setPatient} />

        <Text style={s.label}>Nature of Emergency</Text>
        <View style={s.chipsGrid}>
          {EMERGENCIES.map((e) => (
            <Pressable key={e} style={[s.chip, nature === e && s.chipActive]} onPress={() => setNature(e)}>
              <Text style={[s.chipTxt, nature === e && s.chipTxtActive]}>{e}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={[s.alertBtn, (!location || !nature) && { opacity: 0.5 }]} onPress={() => setShowConfirm(true)} disabled={!location || !nature}>
          <Ionicons name="medkit-outline" size={20} color="#fff" />
          <Text style={s.alertBtnTxt}>Send Medical Alert</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={showConfirm} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <Ionicons name="warning" size={40} color="#f97316" />
            <Text style={s.modalTitle}>Confirm Medical Alert</Text>
            <Text style={s.modalSub}>This will immediately alert the estate medical team. Continue?</Text>
            <View style={s.modalActions}>
              <Pressable style={s.modalCancel} onPress={() => setShowConfirm(false)}><Text style={s.modalCancelTxt}>Cancel</Text></Pressable>
              <Pressable style={[s.modalConfirm, mutation.isPending && { opacity: 0.6 }]} onPress={() => mutation.mutate()} disabled={mutation.isPending}>
                <Text style={s.modalConfirmTxt}>{mutation.isPending ? 'Sending…' : 'Send Now'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#dc2626' },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  alertBanner: { flexDirection: 'row', gap: 10, backgroundColor: '#f97316', borderRadius: 12, padding: 14, alignItems: 'center' },
  alertBannerTxt: { flex: 1, color: '#fff', fontSize: 13, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  chipsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: colors.neutral.border, backgroundColor: colors.neutral.surface },
  chipActive: { backgroundColor: '#f97316', borderColor: '#f97316' },
  chipTxt: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '500' },
  chipTxtActive: { color: '#fff', fontWeight: '700' },
  alertBtn: { backgroundColor: '#f97316', borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  alertBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center', gap: 12, width: '100%' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.neutral.text },
  modalSub: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center' },
  modalActions: { flexDirection: 'row', gap: 12, width: '100%', marginTop: 8 },
  modalCancel: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  modalCancelTxt: { color: colors.neutral.text, fontWeight: '600' },
  modalConfirm: { flex: 1, height: 48, borderRadius: 12, backgroundColor: '#f97316', alignItems: 'center', justifyContent: 'center' },
  modalConfirmTxt: { color: '#fff', fontWeight: '700' },
});
