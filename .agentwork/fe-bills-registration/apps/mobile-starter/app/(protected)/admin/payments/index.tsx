// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const DEFAULTERS = [
  { id: '1', name: 'Tunde Adeyemi', unit: 'D3', amount: 85000, days: 42 },
  { id: '2', name: 'Chike Onwu', unit: 'A7', amount: 55000, days: 30 },
  { id: '3', name: 'Bisi Afolabi', unit: 'B2', amount: 45000, days: 22 },
  { id: '4', name: 'Yemi Ola', unit: 'C9', amount: 30000, days: 15 },
].sort((a, b) => b.amount - a.amount);

export default function PaymentDefaulters() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.header, { backgroundColor: '#7f1d1d' }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Payment Defaulters</Text>
        <Pressable style={styles.backBtn}>
          <Ionicons name="megaphone" size={20} color="#fff" />
        </Pressable>
      </View>
      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>4 defaulters · ₦{(215000).toLocaleString()} total outstanding</Text>
      </View>
      <FlatList
        data={DEFAULTERS}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={[styles.listRow]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.name.split(' ').map(n => n[0]).join('')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{item.name}</Text>
                <Text style={styles.listSub}>Unit {item.unit}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.amountText}>₦{item.amount.toLocaleString()}</Text>
                <Text style={styles.daysText}>{item.days} days overdue</Text>
              </View>
            </View>
            <View style={styles.cardFooter}>
              <Pressable style={styles.reminderBtn}>
                <Ionicons name="mail-outline" size={14} color={colors.secondary.DEFAULT} />
                <Text style={styles.reminderBtnText}>Send Reminder</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  summaryBar: { backgroundColor: colors.secondary.red + '15', padding: 12, paddingHorizontal: 16 },
  summaryText: { fontSize: 13, fontWeight: '600', color: colors.secondary.red, textAlign: 'center' },
  listContent: { padding: 16 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.secondary.red + '20', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '700', color: colors.secondary.red },
  listTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  listSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  amountText: { fontSize: 15, fontWeight: '800', color: colors.secondary.red },
  daysText: { fontSize: 11, color: colors.secondary.red, marginTop: 2 },
  cardFooter: { borderTopWidth: 1, borderTopColor: colors.neutral.border, padding: 10, paddingHorizontal: 14 },
  reminderBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end' },
  reminderBtnText: { fontSize: 13, fontWeight: '600', color: colors.secondary.DEFAULT },
});
