// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const SECTIONS = [
  { title: 'Estate Info', rows: [{ label: 'Estate Name & Address', icon: 'business', route: '/admin/settings/estate-info' }, { label: 'Logo & Branding', icon: 'image', route: '/admin/settings/estate-info' }] },
  { title: 'Subscription & Plans', rows: [{ label: 'Current Plan', icon: 'card', route: '/admin/settings' }, { label: 'Billing', icon: 'receipt', route: '/admin/settings' }] },
  { title: 'Notification Templates', rows: [{ label: 'Reminder Templates', icon: 'mail', route: '/admin/settings' }, { label: 'Announcement Templates', icon: 'megaphone', route: '/admin/settings' }] },
  { title: 'Integration Settings', rows: [{ label: 'Payment Gateway', icon: 'wallet', route: '/admin/settings' }, { label: 'SMS Provider', icon: 'chatbubble', route: '/admin/settings' }] },
];

export default function EstateSettings() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>System Settings</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {SECTIONS.map((section, si) => (
          <View key={si}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.card}>
              {section.rows.map((row, ri) => (
                <Pressable key={ri} style={[styles.listRow, ri < section.rows.length - 1 && styles.listBorder]} onPress={() => router.push(row.route as never)}>
                  <View style={styles.rowIcon}>
                    <Ionicons name={row.icon as any} size={18} color={colors.primary.DEFAULT} />
                  </View>
                  <Text style={styles.listTitle}>{row.label}</Text>
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
  content: { padding: 20, gap: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.neutral.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  listTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  rowIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
});
