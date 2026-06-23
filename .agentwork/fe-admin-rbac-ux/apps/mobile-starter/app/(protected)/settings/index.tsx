// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const SECTIONS = [
  { title: 'Account', rows: [
    { label: 'Profile', icon: 'person-circle', route: '/settings/profile' },
    { label: 'Household', icon: 'home', route: '/settings/household' },
    { label: 'Property', icon: 'business', route: '/settings/property' },
  ]},
  { title: 'Preferences', rows: [
    { label: 'Notifications', icon: 'notifications', route: '/settings/notifications' },
    { label: 'Privacy', icon: 'eye-off', route: '/settings/privacy' },
    { label: 'Language', icon: 'language', route: '/settings/language' },
    { label: 'Theme', icon: 'color-palette', route: '/settings/theme' },
  ]},
  { title: 'Security', rows: [
    { label: 'Change Password', icon: 'lock-closed', route: '/settings/change-password' },
    { label: 'Biometric', icon: 'finger-print', route: '/settings/biometric' },
    { label: 'Two-Factor Auth', icon: 'shield-checkmark', route: '/settings/two-factor' },
    { label: 'Active Devices', icon: 'phone-portrait', route: '/settings/devices' },
  ]},
  { title: 'Estate', rows: [
    { label: 'Visitor Settings', icon: 'person-add', route: '/settings/visitor' },
    { label: 'Payment Settings', icon: 'card', route: '/settings/payment' },
  ]},
  { title: 'Help', rows: [
    { label: 'Help Center', icon: 'help-circle', route: '/settings/help' },
    { label: 'FAQs', icon: 'chatbox', route: '/settings/faq' },
    { label: 'Contact Support', icon: 'headset', route: '/settings/contact-support' },
    { label: 'Terms of Service', icon: 'document-text', route: '/settings/terms' },
    { label: 'Privacy Policy', icon: 'shield', route: '/settings/privacy-policy' },
  ]},
  { title: 'Danger Zone', rows: [
    { label: 'Delete Account', icon: 'trash', route: '/settings/delete-account', danger: true },
    { label: 'Sign Out', icon: 'log-out', route: '/settings/logout', danger: true },
  ]},
];

export default function SettingsHub() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}><Text style={styles.avatarText}>AO</Text></View>
          <View>
            <Text style={styles.profileName}>Adaeze Okonkwo</Text>
            <Text style={styles.profileEmail}>adaeze@example.com</Text>
          </View>
        </View>
        {SECTIONS.map((section, si) => (
          <View key={si}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.card}>
              {section.rows.map((row, ri) => (
                <Pressable key={ri} style={[styles.listRow, ri < section.rows.length - 1 && styles.listBorder]} onPress={() => router.push(row.route as never)}>
                  <View style={[styles.rowIcon, row.danger && { backgroundColor: colors.secondary.red + '15' }]}>
                    <Ionicons name={row.icon as any} size={18} color={row.danger ? colors.secondary.red : colors.primary.DEFAULT} />
                  </View>
                  <Text style={[styles.listTitle, row.danger && { color: colors.secondary.red }]}>{row.label}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 10 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, marginBottom: 4, shadowColor: '#000', shadowOpacity: 0.04, elevation: 1 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary.DEFAULT + '20', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '800', color: colors.primary.DEFAULT },
  profileName: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  profileEmail: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 2 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.neutral.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 4 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  rowIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
});
