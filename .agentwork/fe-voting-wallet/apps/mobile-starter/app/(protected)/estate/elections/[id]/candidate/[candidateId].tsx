// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const AVATAR_COLORS = ['#340075', '#0051d5', '#059669', '#f59e0b', '#dc2626', '#7c3aed'];

function getAvatarColor(name: string) {
  const idx = (name?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

function initials(name: string) {
  return (name ?? '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

export default function CandidateProfile() {
  const router = useRouter();
  const { id, candidateId } = useLocalSearchParams();
  const [candidate, setCandidate] = useState(null);
  const [electionOpen, setElectionOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/estate/elections/${id}/candidates/${candidateId}`).then(r => r.json()),
      fetch(`/api/estate/elections/${id}`).then(r => r.json()),
    ])
      .then(([cData, eData]) => {
        setCandidate(cData.data ?? cData);
        setElectionOpen((eData.data ?? eData)?.status === 'open');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, candidateId]);

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
      </SafeAreaView>
    );
  }

  if (error || !candidate) {
    return (
      <SafeAreaView style={s.center}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.secondary.red} />
        <Text style={s.errorText}>{error ?? 'Candidate not found'}</Text>
        <Pressable style={s.ghostBtn} onPress={() => router.back()}>
          <Text style={s.ghostBtnText}>Go Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.hTitle}>Candidate Profile</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.heroSection}>
          <View style={[s.avatar, { backgroundColor: getAvatarColor(candidate.name) }]}>
            <Text style={s.avatarText}>{initials(candidate.name)}</Text>
          </View>
          <Text style={s.name}>{candidate.name}</Text>
          <View style={s.positionBadge}>
            <Text style={s.positionText}>{candidate.position ?? 'Candidate'}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Manifesto</Text>
          <Text style={s.bodyText}>{candidate.manifesto ?? 'No manifesto provided.'}</Text>
        </View>

        {candidate.campaign_message && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Campaign Message</Text>
            <Text style={s.bodyText}>{candidate.campaign_message}</Text>
          </View>
        )}

        <View style={s.section}>
          <Text style={s.sectionTitle}>Media Gallery</Text>
          <View style={s.galleryRow}>
            {[0, 1, 2].map(i => (
              <View key={i} style={s.galleryBox}>
                <Ionicons name="image-outline" size={28} color={colors.neutral.placeholder} />
              </View>
            ))}
          </View>
        </View>

        {electionOpen && (
          <Pressable
            style={s.voteBtn}
            onPress={() => router.push(`/estate/elections/${id}/vote` as never)}
          >
            <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
            <Text style={s.voteBtnText}>Vote for {candidate.name?.split(' ')[0] ?? 'Candidate'}</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutral.background, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  body: { paddingBottom: 40 },
  heroSection: { alignItems: 'center', paddingVertical: 28, backgroundColor: colors.neutral.surface, borderBottomWidth: 1, borderBottomColor: colors.neutral.border, marginBottom: 16 },
  avatar: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontSize: 28, fontWeight: '700', color: '#fff' },
  name: { fontSize: 20, fontWeight: '700', color: colors.neutral.text, marginBottom: 8 },
  positionBadge: { backgroundColor: colors.neutral.surfaceAlt, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 16 },
  positionText: { fontSize: 13, color: colors.primary.DEFAULT, fontWeight: '600' },
  section: { marginHorizontal: 16, marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text, marginBottom: 8 },
  bodyText: { fontSize: 14, color: colors.neutral.textMuted, lineHeight: 22 },
  galleryRow: { flexDirection: 'row', gap: 10 },
  galleryBox: { flex: 1, aspectRatio: 1, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.neutral.border },
  voteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.secondary.emerald, borderRadius: 12, marginHorizontal: 16, paddingVertical: 16, marginTop: 8 },
  voteBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  errorText: { fontSize: 15, color: colors.neutral.text, marginTop: 12, marginBottom: 20, textAlign: 'center' },
  ghostBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10, borderWidth: 1, borderColor: colors.neutral.border },
  ghostBtnText: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '600' },
});
