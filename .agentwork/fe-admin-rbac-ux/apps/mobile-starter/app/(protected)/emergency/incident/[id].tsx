// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const STEPS = ['Reported', 'Acknowledged', 'Responding', 'Resolved'];

const CAT_COLORS = {
  theft: { bg: '#fee2e2', text: '#991b1b' },
  vandalism: { bg: '#fef3c7', text: '#92400e' },
  noise: { bg: '#dbeafe', text: '#1d4ed8' },
  fire: { bg: '#fff7ed', text: '#c2410c' },
  medical: { bg: '#dcfce7', text: '#166534' },
  other: { bg: '#f3f4f6', text: '#6b7280' },
};

export default function IncidentDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();

  const { data: incident, isLoading, isError, refetch } = useQuery({
    queryKey: ['incident', id],
    queryFn: async () => {
      const res = await fetch(`/api/emergency/incidents/${id}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!id,
  });

  const currentStep = STEPS.findIndex((s) => s.toLowerCase() === incident?.status) ?? 0;
  const cc = CAT_COLORS[incident?.category] ?? CAT_COLORS.other;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Incident Report</Text>
        <View style={{ width: 38 }} />
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : isError ? (
        <View style={s.errCard}>
          <Text style={s.errTxt}>Failed to load incident</Text>
          <Pressable onPress={() => refetch()}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          {/* Status tracker */}
          <View style={s.card}>
            <View style={s.tracker}>
              {STEPS.map((step, i) => (
                <View key={step} style={{ flex: 1, alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
                    {i > 0 && <View style={[s.trackerLine, i <= currentStep && s.trackerLineActive]} />}
                    <View style={[s.trackerDot, i <= currentStep && s.trackerDotActive]}>
                      {i <= currentStep && <Ionicons name="checkmark" size={10} color="#fff" />}
                    </View>
                    {i < STEPS.length - 1 && <View style={[s.trackerLine, i < currentStep && s.trackerLineActive]} />}
                  </View>
                  <Text style={[s.trackerLabel, i <= currentStep && s.trackerLabelActive]} numberOfLines={2}>{step}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Category & description */}
          <View style={s.card}>
            <View style={[s.infoRow, s.rowBorder]}>
              <Text style={s.infoLabel}>Category</Text>
              <View style={[s.badge, { backgroundColor: cc.bg }]}><Text style={[s.badgeTxt, { color: cc.text }]}>{incident?.category}</Text></View>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Date Reported</Text>
              <Text style={s.infoVal}>{incident?.created_at ? new Date(incident.created_at).toLocaleDateString('en-NG') : '—'}</Text>
            </View>
          </View>

          {incident?.description ? (
            <View style={s.card}>
              <Text style={[s.infoLabel, { marginBottom: 8 }]}>Description</Text>
              <Text style={s.descTxt}>{incident.description}</Text>
            </View>
          ) : null}

          {/* Evidence */}
          <View style={s.card}>
            <Text style={[s.infoLabel, { marginBottom: 8 }]}>Evidence</Text>
            <View style={s.photosRow}>
              {[1, 2, 3].map((n) => (
                <View key={n} style={s.photoBox}><Ionicons name="image-outline" size={20} color={colors.neutral.placeholder} /></View>
              ))}
            </View>
          </View>

          {/* Response notes */}
          {incident?.response_notes ? (
            <View style={s.card}>
              <Text style={[s.infoLabel, { marginBottom: 8 }]}>Response Notes</Text>
              <Text style={s.descTxt}>{incident.response_notes}</Text>
            </View>
          ) : null}

          {/* Timeline */}
          {incident?.timeline?.length > 0 && (
            <View style={s.card}>
              <Text style={[s.infoLabel, { marginBottom: 8 }]}>Timeline</Text>
              {incident.timeline.map((t, i) => (
                <View key={i} style={[s.timelineRow, i < incident.timeline.length - 1 && s.rowBorder]}>
                  <View style={[s.tlDot, { backgroundColor: '#dc2626' }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.tlStatus}>{t.status}</Text>
                    <Text style={s.tlTime}>{new Date(t.timestamp).toLocaleString('en-NG')}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#dc2626' },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  tracker: { flexDirection: 'row', paddingVertical: 8 },
  trackerDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  trackerDotActive: { backgroundColor: '#dc2626' },
  trackerLine: { flex: 1, height: 2, backgroundColor: colors.neutral.border },
  trackerLineActive: { backgroundColor: '#dc2626' },
  trackerLabel: { fontSize: 9, color: colors.neutral.placeholder, textAlign: 'center', marginTop: 4 },
  trackerLabelActive: { color: '#dc2626', fontWeight: '600' },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  infoLabel: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600' },
  infoVal: { fontSize: 13, fontWeight: '500', color: colors.neutral.text },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  badgeTxt: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  descTxt: { fontSize: 14, color: colors.neutral.text, lineHeight: 22 },
  photosRow: { flexDirection: 'row', gap: 8 },
  photoBox: { flex: 1, height: 70, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  tlDot: { width: 8, height: 8, borderRadius: 4 },
  tlStatus: { fontSize: 13, fontWeight: '600', color: colors.neutral.text, textTransform: 'capitalize' },
  tlTime: { fontSize: 11, color: colors.neutral.textMuted },
  errCard: { margin: 20, padding: 16, backgroundColor: '#fee2e2', borderRadius: 12, alignItems: 'center', gap: 8 },
  errTxt: { color: '#991b1b', fontSize: 14 },
  retryTxt: { color: colors.primary.DEFAULT, fontWeight: '700', fontSize: 14 },
});
