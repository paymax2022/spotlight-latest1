// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const DUE_ITEM = { title: 'Security Levy', amount: 1500000, due_date: new Date(Date.now() + 5 * 86400000).toISOString() };
const daysLeft = Math.ceil((new Date(DUE_ITEM.due_date).getTime() - Date.now()) / 86400000);

export default function ReminderScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Upcoming Payment</Text>
        <View style={{ width: 38 }} />
      </View>
      <View style={styles.container}>
        <View style={styles.countdownCard}>
          <Ionicons name="calendar-outline" size={36} color={colors.secondary.amber} />
          <Text style={styles.countdownNumber}>{daysLeft}</Text>
          <Text style={styles.countdownLabel}>days remaining</Text>
        </View>

        <View style={styles.card}>
          <View style={[styles.row, styles.listBorder]}>
            <Text style={styles.label}>Due</Text>
            <Text style={styles.value}>{DUE_ITEM.title}</Text>
          </View>
          <View style={[styles.row, styles.listBorder]}>
            <Text style={styles.label}>Amount</Text>
            <Text style={[styles.value, { color: colors.primary.DEFAULT, fontWeight: '700' }]}>{fmt(DUE_ITEM.amount)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Due Date</Text>
            <Text style={styles.value}>{new Date(DUE_ITEM.due_date).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
          </View>
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push({ pathname: '/estate/dues/pay', params: { amount: DUE_ITEM.amount, description: DUE_ITEM.title } } as never)}>
          <Text style={styles.primaryBtnText}>Pay Now</Text>
        </Pressable>
        <Pressable style={styles.ghostBtn} onPress={() => Alert.alert('Calendar', 'Calendar reminder functionality coming soon')}>
          <Ionicons name="calendar-outline" size={18} color={colors.primary.DEFAULT} />
          <Text style={styles.ghostBtnText}>Set Calendar Reminder</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  container: { flex: 1, padding: 20, gap: 16 },
  countdownCard: { backgroundColor: colors.neutral.surface, borderRadius: 20, padding: 28, alignItems: 'center', gap: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  countdownNumber: { fontSize: 72, fontWeight: '800', color: colors.secondary.amber, lineHeight: 80 },
  countdownLabel: { fontSize: 16, color: colors.neutral.textMuted },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghostBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1.5, borderColor: colors.primary.DEFAULT },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: colors.primary.DEFAULT },
});
