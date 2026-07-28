// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const REVIEWS = [
  { id: '1', reviewer: 'Adaeze O.', rating: 5, comment: 'Excellent work! Fixed the issue quickly and professionally.', date: 'Dec 10' },
  { id: '2', reviewer: 'James A.', rating: 4, comment: 'Good job, arrived on time. Would recommend.', date: 'Dec 5' },
  { id: '3', reviewer: 'Ngozi E.', rating: 5, comment: 'Outstanding! Cleaned up after himself too.', date: 'Nov 28' },
];
const DIST = [{ stars: 5, count: 30 }, { stars: 4, count: 12 }, { stars: 3, count: 3 }, { stars: 2, count: 1 }, { stars: 1, count: 0 }];
const total = DIST.reduce((s, d) => s + d.count, 0);
const avg = 4.8;

export default function VendorRating() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>My Ratings</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.avgNum}>{avg}</Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map(i => (
              <Ionicons key={i} name={i <= Math.floor(avg) ? 'star' : 'star-outline'} size={22} color="#C5A059" />
            ))}
          </View>
          <Text style={styles.totalText}>{total} reviews</Text>
        </View>

        <View style={styles.distCard}>
          {DIST.map(d => (
            <View key={d.stars} style={styles.distRow}>
              <Text style={styles.distLabel}>{d.stars}</Text>
              <Ionicons name="star" size={12} color="#C5A059" />
              <View style={styles.distTrack}>
                <View style={[styles.distBar, { width: `${total > 0 ? (d.count / total) * 100 : 0}%` }]} />
              </View>
              <Text style={styles.distCount}>{d.count}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Recent Reviews</Text>
        {REVIEWS.map((r) => (
          <View key={r.id} style={styles.reviewCard}>
            <View style={styles.reviewHeader}>
              <View style={styles.reviewAvatar}><Text style={styles.reviewAvatarText}>{r.reviewer[0]}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{r.reviewer}</Text>
                <View style={styles.reviewStars}>
                  {[1, 2, 3, 4, 5].map(i => (
                    <Ionicons key={i} name={i <= r.rating ? 'star' : 'star-outline'} size={13} color="#C5A059" />
                  ))}
                </View>
              </View>
              <Text style={styles.reviewDate}>{r.date}</Text>
            </View>
            <Text style={styles.reviewComment}>{r.comment}</Text>
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
  content: { padding: 20, gap: 16 },
  summaryCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 24, alignItems: 'center', gap: 6, shadowColor: '#000', shadowOpacity: 0.06, elevation: 3 },
  avgNum: { fontSize: 52, fontWeight: '900', color: colors.neutral.text },
  starsRow: { flexDirection: 'row', gap: 4 },
  totalText: { fontSize: 13, color: colors.neutral.textMuted },
  distCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, gap: 8 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  distLabel: { fontSize: 13, fontWeight: '700', color: colors.neutral.text, width: 12, textAlign: 'right' },
  distTrack: { flex: 1, height: 8, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 4 },
  distBar: { height: 8, backgroundColor: '#C5A059', borderRadius: 4 },
  distCount: { fontSize: 12, color: colors.neutral.textMuted, width: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  reviewCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, gap: 8 },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary.DEFAULT + '20', alignItems: 'center', justifyContent: 'center' },
  reviewAvatarText: { fontSize: 14, fontWeight: '700', color: colors.primary.DEFAULT },
  listTitle: { fontSize: 13, fontWeight: '700', color: colors.neutral.text },
  reviewStars: { flexDirection: 'row', gap: 2, marginTop: 2 },
  reviewDate: { fontSize: 11, color: colors.neutral.placeholder },
  reviewComment: { fontSize: 13, color: colors.neutral.text, lineHeight: 20 },
});
