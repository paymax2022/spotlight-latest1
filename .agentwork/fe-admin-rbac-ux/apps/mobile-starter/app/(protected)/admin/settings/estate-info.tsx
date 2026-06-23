// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const ESTATE_TYPES = ['Gated', 'Open', 'Mixed'];

export default function EstateInfo() {
  const router = useRouter();
  const [name, setName] = useState('Green Estate');
  const [address, setAddress] = useState('15 Estate Road, Lekki');
  const [state, setState] = useState('Lagos');
  const [lga, setLga] = useState('Eti-Osa');
  const [email, setEmail] = useState('admin@greenestate.ng');
  const [type, setType] = useState('Gated');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Estate Info</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.logoWrap}>
          <Ionicons name="business" size={40} color={colors.primary.DEFAULT} />
          <Text style={styles.logoHint}>Tap to upload logo</Text>
        </Pressable>

        {[
          { label: 'Estate Name', value: name, set: setName },
          { label: 'Address', value: address, set: setAddress },
          { label: 'State', value: state, set: setState },
          { label: 'LGA', value: lga, set: setLga },
          { label: 'Contact Email', value: email, set: setEmail },
        ].map((field, i) => (
          <View key={i} style={styles.fieldGroup}>
            <Text style={styles.label}>{field.label}</Text>
            <TextInput style={styles.input} value={field.value} onChangeText={field.set} placeholderTextColor={colors.neutral.placeholder} />
          </View>
        ))}

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Estate Type</Text>
          <View style={styles.typeRow}>
            {ESTATE_TYPES.map(t => (
              <Pressable key={t} style={[styles.typeChip, type === t && styles.typeChipActive]} onPress={() => setType(t)}>
                <Text style={[styles.typeChipText, type === t && styles.typeChipTextActive]}>{t}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Save Changes</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16 },
  logoWrap: { alignSelf: 'center', width: 90, height: 90, borderRadius: 20, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 2, borderColor: colors.neutral.border, borderStyle: 'dashed' },
  logoHint: { fontSize: 10, color: colors.neutral.placeholder },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeChip: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: colors.neutral.surface, borderWidth: 1.5, borderColor: colors.neutral.border },
  typeChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  typeChipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  typeChipTextActive: { color: '#fff' },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
