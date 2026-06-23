// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function AlreadyVoted() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [vote, setVote] = useState(null);
  const [electionTallied, setElectionTallied] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/estate/elections/${id}/my-vote`).then(r => r.json()),
      fetch(`/api/estate/elections/${id}`).then(r => r.json()),
    ])
      .then(([vData, eData]) => {
        setVote(vData.data ?? vData);
        setElectionTallied((eData.data ?? eData)?.status === 'tallied');
      })
      .catch(() => {});
  }, [id]);

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.hTitle}>Already Voted</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.heroSection}>
          <View style={s.checkCircle}>
            <Ionicons name="checkmark-circle" size={44} color="#fff" />
          </View>
          <Text style={s.heroTitle}>You've Already Voted</Text>
          <Text style={s.heroSubtitle}>Your vote has been recorded and cannot be changed.</Text>
        </View>

        {vote && (
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.rowLabel}>Voted On</Text>
              <Text style={s.rowValue}>{vote.voted_at ? new Date(vote.voted_at).toLocaleString() : '—'}</Text>
            </View>
            {vote.reference && (
              <>
                <View style={s.divider} />
                <View style={s.row}>
                  <Text style={s.rowLabel}>Reference</Text>
                  <Text style={s.rowValue}>{vote.reference}</Text>
                </View>
              </>
            )}
          </View>
        )}

        {electionTallied && (
          <Pressable style={s.primaryBtn} onPress={() => router.push(`/estate/elections/${id}/results` as never)}>
            <Ionicons name="podium-outline" size={18} color="#fff" />
            <Text style={s.primaryBtnText}>View Results</Text>
          </Pressable>
        )}

        <Pressable style={s.ghostBtn} onPress={() => router.replace('/estate/elections' as never)}>
          <Text style={s.ghostBtnText}>Back to Elections</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  body: { padding: 16, paddingBottom: 40 },
  heroSection: { alignItems: 'center', paddingVertical: 40 },
  checkCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heroTitle: { fontSize: 22, fontWeight: '700', color: colors.neutral.text, marginBottom: 8, textAlign: 'center' },
  heroSubtitle: { fontSize: 14, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 20 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: colors.neutral.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  rowLabel: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '600' },
  rowValue: { fontSize: 13, color: colors.neutral.text, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.neutral.border },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary.DEFAULT, borderRadius: 12, paddingVertical: 16, marginBottom: 12 },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  ghostBtn: { borderWidth: 1, borderColor: colors.neutral.border, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  ghostBtnText: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '600' },
});
