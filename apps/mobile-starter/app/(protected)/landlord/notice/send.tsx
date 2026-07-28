// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const TENANTS = ['James Okafor (A1)', 'Amaka Eze (B3)'];
const NOTICE_TYPES = ['Payment Reminder', 'Lease Renewal', 'Violation', 'Move-out'];

export default function SendNotice() {
  const router = useRouter();
  const [tenant, setTenant] = useState(TENANTS[0]);
  const [type, setType] = useState('Payment Reminder');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: '#7a5c1e' }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Send Notice</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Select Tenant</Text>
          <View style={styles.tenantWrap}>
            {TENANTS.map(t => (
              <Pressable key={t} style={[styles.tenantChip, tenant === t && styles.tenantChipActive]} onPress={() => setTenant(t)}>
                <Text style={[styles.tenantChipText, tenant === t && styles.tenantChipTextActive]}>{t}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Notice Type</Text>
          <View style={styles.typeRow}>
            {NOTICE_TYPES.map(n => (
              <Pressable key={n} style={[styles.typeChip, type === n && styles.typeChipActive]} onPress={() => setType(n)}>
                <Text style={[styles.typeChipText, type === n && styles.typeChipTextActive]}>{n}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Subject</Text>
          <TextInput style={styles.input} value={subject} onChangeText={setSubject} placeholder="Enter subject..." placeholderTextColor={colors.neutral.placeholder} />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Message</Text>
          <TextInput style={[styles.input, styles.textarea]} value={message} onChangeText={setMessage} placeholder="Type your message..." placeholderTextColor={colors.neutral.placeholder} multiline numberOfLines={5} textAlignVertical="top" />
        </View>

        <Pressable style={[styles.primaryBtn, { backgroundColor: '#C5A059' }]}>
          <Ionicons name="send" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Send Notice</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16 },
  fieldGroup: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  tenantWrap: { gap: 8 },
  tenantChip: { padding: 12, borderRadius: 12, backgroundColor: colors.neutral.surface, borderWidth: 1.5, borderColor: colors.neutral.border },
  tenantChipActive: { backgroundColor: '#C5A059' + '15', borderColor: '#C5A059' },
  tenantChipText: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '600' },
  tenantChipTextActive: { color: '#7a5c1e' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.neutral.surface, borderWidth: 1.5, borderColor: colors.neutral.border },
  typeChipActive: { backgroundColor: '#C5A059', borderColor: '#C5A059' },
  typeChipText: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600' },
  typeChipTextActive: { color: '#fff' },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  textarea: { height: 120, paddingTop: 14 },
  primaryBtn: { borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
