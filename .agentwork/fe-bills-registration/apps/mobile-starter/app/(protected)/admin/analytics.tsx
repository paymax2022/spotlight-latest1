// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const ANALYTICS_CARDS = [
  { title: 'Resident Growth', icon: 'trending-up', value: '+12', sub: 'New this month', color: colors.secondary.DEFAULT, route: '/analytics/residents' },
  { title: 'Payment Collection Rate', icon: 'cash', value: '87%', sub: 'vs 82% last month', color: colors.secondary.emerald, route: '/analytics/payments' },
  { title: 'Visitor Volume', icon: 'walk', value: '342', sub: 'Entries this month', color: colors.secondary.amber, route: '/analytics/visitors' },
  { title: 'Security Incidents', icon: 'warning', value: '3', sub: 'This month', color: colors.secondary.red, route: '/analytics/security' },
];

export default function AdminAnalytics() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Analytics</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Estate Overview</Text>
        {ANALYTICS_CARDS.map((card, i) => (
          <Pressable key={i} style={styles.card} onPress={() => router.push(card.route as never)}>
            <View style={[styles.cardIconWrap, { backgroundColor: card.color + '15' }]}>
              <Ionicons name={card.icon as any} size={24} color={card.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.cardSub}>{card.sub}</Text>
              <View style={styles.sparklinePlaceholder}>
                {[0.4, 0.6, 0.5, 0.8, 0.7, 0.9, 1.0].map((h, j) => (
                  <View key={j} style={[styles.sparkBar, { height: h * 24, backgroundColor: card.color + '40' }]} />
                ))}
              </View>
            </View>
            <View style={styles.valueWrap}>
              <Text style={[styles.cardValue, { color: card.color }]}>{card.value}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
            </View>
          </Pressable>
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
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardIconWrap: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  cardSub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  sparklinePlaceholder: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginTop: 8, height: 24 },
  sparkBar: { width: 6, borderRadius: 3 },
  valueWrap: { alignItems: 'center', gap: 4 },
  cardValue: { fontSize: 22, fontWeight: '800' },
});
