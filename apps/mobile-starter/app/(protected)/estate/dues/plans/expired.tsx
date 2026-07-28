// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const EXPIRED_DATE = new Date(Date.now() - 5 * 86400000);
const daysSince = 5;

export default function ExpiredScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconWrap}><Ionicons name="calendar" size={80} color={colors.secondary.red} /></View>
        <Text style={styles.title}>Subscription Expired</Text>
        <Text style={styles.sub}>Your subscription expired {daysSince} days ago on {EXPIRED_DATE.toLocaleDateString('en-NG')}.</Text>

        <View style={styles.card}>
          <View style={[styles.row, styles.listBorder]}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.secondary.red} />
            <Text style={styles.restrictionText}>Community posts restricted</Text>
          </View>
          <View style={[styles.row, styles.listBorder]}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.secondary.red} />
            <Text style={styles.restrictionText}>Facility booking disabled</Text>
          </View>
          <View style={styles.row}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.secondary.red} />
            <Text style={styles.restrictionText}>Voting access suspended</Text>
          </View>
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.push('/estate/dues/plans/renewal' as never)}>
          <Text style={styles.primaryBtnText}>Renew Subscription</Text>
        </Pressable>
        <Pressable style={styles.ghostBtn} onPress={() => router.push('/estate/dues/plans' as never)}>
          <Text style={styles.ghostBtnText}>View Plans</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  container: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 16 },
  iconWrap: { marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: colors.secondary.red },
  sub: { fontSize: 15, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 24 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  listBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  restrictionText: { fontSize: 14, color: colors.neutral.text },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', width: '100%' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghostBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.primary.DEFAULT, width: '100%' },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: colors.primary.DEFAULT },
});
