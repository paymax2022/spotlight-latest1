// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function PaymentFailedScreen() {
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.icon}>
          <Ionicons name="close-circle" size={80} color="#dc2626" />
        </View>
        <Text style={styles.title}>Payment Failed</Text>
        <Text style={styles.reason}>{reason ?? 'Your payment could not be processed. Please try again.'}</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="information-circle-outline" size={18} color={colors.secondary.DEFAULT} />
            <Text style={styles.infoText}>If you were charged, the amount will be refunded within 3-5 business days.</Text>
          </View>
        </View>

        <Pressable style={styles.primaryBtn} onPress={() => router.back()}>
          <Ionicons name="refresh-outline" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Try Again</Text>
        </Pressable>

        <Pressable style={styles.ghostBtn} onPress={() => router.push('/support' as never)}>
          <Text style={styles.ghostBtnText}>Contact Support</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  content: { padding: 24, gap: 16, alignItems: 'center' },
  icon: { marginTop: 40, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  reason: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 22 },
  card: { backgroundColor: '#eff6ff', borderRadius: 14, padding: 14, width: '100%' },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  infoText: { fontSize: 13, color: colors.secondary.DEFAULT, flex: 1, lineHeight: 20 },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, width: '100%' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghostBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.neutral.border, width: '100%' },
  ghostBtnText: { fontSize: 15, fontWeight: '600', color: colors.neutral.textMuted },
});
