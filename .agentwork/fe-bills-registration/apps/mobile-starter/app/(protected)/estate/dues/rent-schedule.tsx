// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const fmt = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const RENT = 25000000;

type PayStatus = 'paid' | 'upcoming' | 'overdue';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const TODAY = new Date();

function getStatus(month: number, year: number): PayStatus {
  const due = new Date(year, month, 1);
  if (due < TODAY && due.getMonth() < TODAY.getMonth()) return month < 3 ? 'paid' : 'overdue';
  if (due.getMonth() === TODAY.getMonth() && due.getFullYear() === TODAY.getFullYear()) return 'overdue';
  return 'upcoming';
}

const STATUS_CONFIG = {
  paid: { color: colors.secondary.emerald, bg: '#f0fdf4', icon: 'checkmark-circle' },
  upcoming: { color: colors.secondary.DEFAULT, bg: '#eff6ff', icon: 'time-outline' },
  overdue: { color: colors.secondary.red, bg: '#fef2f2', icon: 'alert-circle' },
};

export default function RentScheduleScreen() {
  const router = useRouter();
  const year = TODAY.getFullYear();
  const schedule = MONTHS.map((m, i) => ({ month: m, i, status: getStatus(i, year) as PayStatus }));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Rent Schedule {year}</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          {schedule.map((s, i) => {
            const cfg = STATUS_CONFIG[s.status];
            return (
              <View key={s.month} style={[styles.row, i < schedule.length - 1 && styles.listBorder]}>
                <View style={[styles.monthDot, { backgroundColor: cfg.bg }]}>
                  <Ionicons name={cfg.icon as any} size={16} color={cfg.color} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.listTitle}>{s.month} {year}</Text>
                  <Text style={styles.listSub}>Due: 1st {s.month}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.amount}>{fmt(RENT)}</Text>
                  <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
                    <Text style={[styles.badgeText, { color: cfg.color }]}>{s.status}</Text>
                  </View>
                </View>
              </View>
            );
          })}
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  monthDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  amount: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, marginTop: 4 },
  badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
});
