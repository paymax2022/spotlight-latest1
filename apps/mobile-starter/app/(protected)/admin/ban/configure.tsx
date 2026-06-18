// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function BanConfigure() {
  const router = useRouter();
  const [softDays, setSoftDays] = useState('30');
  const [hardDays, setHardDays] = useState('90');
  const [graceDays, setGraceDays] = useState('14');
  const [autoLift, setAutoLift] = useState(true);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Ban Configuration</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.warningCard]}>
          <Ionicons name="warning" size={18} color={colors.secondary.amber} />
          <Text style={styles.warningText}>These settings affect access control for all residents. Change carefully.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Soft Restriction After (days overdue)</Text>
            <TextInput style={styles.input} value={softDays} onChangeText={setSoftDays} keyboardType="numeric" />
            <Text style={styles.hint}>Restricts visitor code issuance</Text>
          </View>
          <View style={[styles.fieldWrap, styles.listBorder]}>
            <Text style={styles.label}>Hard Ban After (days overdue)</Text>
            <TextInput style={styles.input} value={hardDays} onChangeText={setHardDays} keyboardType="numeric" />
            <Text style={styles.hint}>Full estate access restriction</Text>
          </View>
          <View style={[styles.fieldWrap, styles.listBorder]}>
            <Text style={styles.label}>Grace Period for New Residents (days)</Text>
            <TextInput style={styles.input} value={graceDays} onChangeText={setGraceDays} keyboardType="numeric" />
          </View>
          <View style={[styles.toggleRow, styles.listBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>Auto-lift Ban on Payment</Text>
              <Text style={styles.listSub}>Automatically restore access when dues are fully paid</Text>
            </View>
            <Switch value={autoLift} onValueChange={setAutoLift} trackColor={{ false: colors.neutral.border, true: colors.primary.DEFAULT }} thumbColor="#fff" />
          </View>
        </View>

        <Pressable style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Save Ban Rules</Text>
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
  warningCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.secondary.amber + '15', borderRadius: 12, padding: 14 },
  warningText: { flex: 1, fontSize: 13, color: colors.neutral.text, lineHeight: 18 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  fieldWrap: { padding: 14, gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, padding: 12, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  hint: { fontSize: 11, color: colors.neutral.placeholder },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listBorder: { borderTopWidth: 1, borderTopColor: colors.neutral.border },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
