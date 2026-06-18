// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';
import { useState } from 'react';

const NOTIF_SETTINGS = [
  { id: 'visitor_arrival', label: 'Visitor Arrival', desc: 'When a visitor arrives at the gate', defaultOn: true },
  { id: 'visitor_denied', label: 'Visitor Denied', desc: 'When a visitor is denied entry', defaultOn: true },
  { id: 'payment_reminder', label: 'Payment Reminder', desc: '3 days before a payment is due', defaultOn: true },
  { id: 'payment_success', label: 'Payment Success', desc: 'Confirmation of successful payments', defaultOn: true },
  { id: 'profile_restriction', label: 'Profile Restriction', desc: 'When your account access is restricted', defaultOn: true },
  { id: 'meeting_reminder', label: 'Meeting Reminder', desc: '1 day before a scheduled meeting', defaultOn: true },
  { id: 'task_assigned', label: 'Task Assigned', desc: 'When a task is assigned to you', defaultOn: false },
  { id: 'repair_status', label: 'Repair Status', desc: 'Updates on your repair requests', defaultOn: true },
  { id: 'election', label: 'Election', desc: 'Estate election announcements and reminders', defaultOn: true },
  { id: 'emergency', label: 'Emergency Alerts', desc: 'Critical estate emergency notifications', defaultOn: true },
];

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<Record<string, boolean>>(
    Object.fromEntries(NOTIF_SETTINGS.map((s) => [s.id, s.defaultOn]))
  );

  const toggle = (id: string) => setSettings((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleSave = () => {
    Alert.alert('Saved', 'Notification preferences have been updated.', [{ text: 'OK', onPress: () => router.back() }]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Notification Settings</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <Ionicons name="notifications-outline" size={18} color={colors.secondary.DEFAULT} />
          <Text style={styles.infoText}>Manage which notifications you receive. Emergency alerts cannot be disabled.</Text>
        </View>

        <View style={styles.card}>
          {NOTIF_SETTINGS.map((item, i) => {
            const isEmergency = item.id === 'emergency';
            return (
              <View key={item.id} style={[styles.row, i < NOTIF_SETTINGS.length - 1 && styles.listBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingLabel}>{item.label}</Text>
                  <Text style={styles.settingDesc}>{item.desc}</Text>
                </View>
                <Switch
                  value={isEmergency ? true : settings[item.id]}
                  onValueChange={() => !isEmergency && toggle(item.id)}
                  trackColor={{ false: colors.neutral.border, true: colors.primary.DEFAULT }}
                  thumbColor="#fff"
                  disabled={isEmergency}
                />
              </View>
            );
          })}
        </View>

        <Pressable style={styles.primaryBtn} onPress={handleSave}>
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
  infoCard: { backgroundColor: '#eff6ff', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoText: { fontSize: 13, color: colors.secondary.DEFAULT, flex: 1, lineHeight: 20 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  settingLabel: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  settingDesc: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
