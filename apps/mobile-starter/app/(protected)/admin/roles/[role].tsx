// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const PERMISSION_GROUPS = [
  { module: 'Residents', perms: ['View Residents', 'Invite Residents', 'Approve Residents', 'Suspend Residents', 'Ban Residents'] },
  { module: 'Payments', perms: ['View Payments', 'Record Payments', 'Issue Refunds', 'Export Reports'] },
  { module: 'Security', perms: ['View Gate Log', 'Override Gate', 'Configure Rules', 'View Incidents'] },
  { module: 'System', perms: ['Manage Roles', 'System Settings', 'View Audit Logs', 'Export Data'] },
];

const CRITICAL = ['Ban Residents', 'Manage Roles', 'System Settings'];

export default function RolePermissions() {
  const router = useRouter();
  const { role } = useLocalSearchParams();
  const [perms, setPerms] = useState<Record<string, boolean>>({
    'View Residents': true, 'Invite Residents': true, 'View Payments': true,
    'View Gate Log': true, 'View Audit Logs': true,
  });

  const toggle = (p: string, v: boolean) => {
    if (!v && CRITICAL.includes(p)) {
      Alert.alert('Warning', `Removing "${p}" may break critical functionality. Proceed?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => setPerms(s => ({ ...s, [p]: false })) },
      ]);
      return;
    }
    setPerms(s => ({ ...s, [p]: v }));
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>{String(role).charAt(0).toUpperCase() + String(role).slice(1)} Permissions</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {PERMISSION_GROUPS.map((group, gi) => (
          <View key={gi}>
            <Text style={styles.sectionTitle}>{group.module}</Text>
            <View style={styles.card}>
              {group.perms.map((p, i) => (
                <View key={p} style={[styles.toggleRow, i < group.perms.length - 1 && styles.listBorder]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listTitle}>{p}</Text>
                    {CRITICAL.includes(p) && (
                      <Text style={[styles.listSub, { color: colors.secondary.amber }]}>Critical permission</Text>
                    )}
                  </View>
                  <Switch
                    value={perms[p] ?? false}
                    onValueChange={v => toggle(p, v)}
                    trackColor={{ false: colors.neutral.border, true: colors.primary.DEFAULT }}
                    thumbColor="#fff"
                  />
                </View>
              ))}
            </View>
          </View>
        ))}
        <Pressable style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Save Permissions</Text>
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
  content: { padding: 20, gap: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.neutral.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, marginTop: 2 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
