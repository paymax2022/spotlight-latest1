// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const TOGGLES = [
  { key: 'defaulterRestrict', label: 'Enable Visitor Restrictions for Defaulters', desc: 'Defaulters cannot issue visitor codes until dues are cleared', default: true },
  { key: 'requirePhoto', label: 'Require Gate Log Photos', desc: 'Guards must attach a photo when logging entries', default: false },
  { key: 'walkIn', label: 'Allow Walk-in Passes', desc: 'Guards can issue walk-in passes for unregistered visitors', default: true },
  { key: 'autoBlacklist', label: 'Auto-blacklist after Violations', desc: 'Automatically flag residents after 3 security violations', default: false },
];

export default function SecurityConfig() {
  const router = useRouter();
  const [settings, setSettings] = useState<Record<string, boolean>>(() =>
    TOGGLES.reduce((acc, t) => ({ ...acc, [t.key]: t.default }), {})
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Security Config</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          {TOGGLES.map((t, i) => (
            <View key={t.key} style={[styles.toggleRow, i < TOGGLES.length - 1 && styles.listBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{t.label}</Text>
                <Text style={styles.listSub}>{t.desc}</Text>
              </View>
              <Switch
                value={settings[t.key]}
                onValueChange={v => setSettings(s => ({ ...s, [t.key]: v }))}
                trackColor={{ false: colors.neutral.border, true: colors.primary.DEFAULT }}
                thumbColor="#fff"
              />
            </View>
          ))}
        </View>
        <Pressable style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Save Settings</Text>
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
