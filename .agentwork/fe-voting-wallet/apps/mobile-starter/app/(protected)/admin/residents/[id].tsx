// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const MOCK = {
  id: '1',
  name: 'Adaeze Okonkwo',
  unit: 'B12',
  role: 'Homeowner',
  status: 'Active',
  phone: '+234 812 345 6789',
  email: 'adaeze@example.com',
  joinDate: 'Jan 2023',
  outstanding: 45000,
};

export default function ResidentProfile() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const resident = MOCK;

  const confirm = (action: string) =>
    Alert.alert(`${action} Resident`, `Are you sure you want to ${action.toLowerCase()} ${resident.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: () => {} },
    ]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Resident Profile</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{resident.name.split(' ').map(n => n[0]).join('')}</Text>
          </View>
          <Text style={styles.name}>{resident.name}</Text>
          <Text style={styles.sub}>Unit {resident.unit} · {resident.role}</Text>
          <View style={[styles.badge, { backgroundColor: colors.secondary.emerald + '20', marginTop: 8 }]}>
            <Text style={[styles.badgeText, { color: colors.secondary.emerald }]}>{resident.status}</Text>
          </View>
        </View>

        <View style={styles.card}>
          {[
            { label: 'Phone', value: resident.phone },
            { label: 'Email', value: resident.email },
            { label: 'Member Since', value: resident.joinDate },
          ].map((row, i) => (
            <View key={i} style={[styles.infoRow, i < 2 && styles.listBorder]}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value}>{row.value}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, { borderWidth: resident.outstanding > 0 ? 1 : 0, borderColor: colors.secondary.red + '40' }]}>
          <View style={styles.listRow}>
            <Ionicons name="wallet-outline" size={20} color={resident.outstanding > 0 ? colors.secondary.red : colors.secondary.emerald} />
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>Payment Status</Text>
              <Text style={[styles.listSub, { color: resident.outstanding > 0 ? colors.secondary.red : colors.secondary.emerald }]}>
                {resident.outstanding > 0 ? `₦${resident.outstanding.toLocaleString()} outstanding` : 'No outstanding dues'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.listRow}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.secondary.emerald} />
            <View style={{ flex: 1 }}>
              <Text style={styles.listTitle}>Access Status</Text>
              <Text style={[styles.listSub, { color: colors.secondary.emerald }]}>Full access granted</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Admin Actions</Text>
        <View style={styles.actionsWrap}>
          {[
            { label: 'Suspend', icon: 'pause-circle', color: colors.secondary.amber },
            { label: 'Restrict Access', icon: 'lock-closed', color: colors.secondary.amber },
            { label: 'Ban', icon: 'ban', color: colors.secondary.red },
            { label: 'Approve', icon: 'checkmark-circle', color: colors.secondary.emerald },
            { label: 'Restore', icon: 'refresh-circle', color: colors.secondary.DEFAULT },
          ].map((a, i) => (
            <Pressable key={i} style={[styles.actionBtn, { borderColor: a.color }]} onPress={() => confirm(a.label)}>
              <Ionicons name={a.icon as any} size={16} color={a.color} />
              <Text style={[styles.actionBtnText, { color: a.color }]}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
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
  profileCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 24, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary.DEFAULT + '20', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontSize: 24, fontWeight: '800', color: colors.primary.DEFAULT },
  name: { fontSize: 18, fontWeight: '700', color: colors.neutral.text },
  sub: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 4 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  actionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 1.5, backgroundColor: colors.neutral.surface },
  actionBtnText: { fontSize: 13, fontWeight: '700' },
});
