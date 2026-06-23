// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const MOCK = {
  id: '1', title: 'Fix leaking roof', cat: 'General Repair', estate: 'Green Estate', description: 'The roof in Block C has been leaking for 2 days affecting the ceiling. Urgent repair needed before the next rain.',
  urgency: 'High', location: 'Block C, Unit 5', value: 45000, posted: '2h ago', status: 'Available',
};

export default function JobDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [status, setStatus] = useState(MOCK.status);
  const job = MOCK;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Job Details</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.jobHeader}>
            <Text style={styles.jobTitle}>{job.title}</Text>
            <View style={[styles.badge, { backgroundColor: colors.secondary.red + '20' }]}>
              <Text style={[styles.badgeText, { color: colors.secondary.red }]}>{job.urgency}</Text>
            </View>
          </View>
          {[
            { label: 'Category', value: job.cat },
            { label: 'Estate', value: job.estate },
            { label: 'Location', value: job.location },
            { label: 'Estimated Value', value: `₦${job.value.toLocaleString()}` },
            { label: 'Posted', value: job.posted },
          ].map((row, i) => (
            <View key={i} style={[styles.infoRow, styles.listBorder]}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.value}>{row.value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.descCard}>
          <Text style={styles.descLabel}>Description</Text>
          <Text style={styles.descText}>{job.description}</Text>
        </View>

        <View style={styles.photosPlaceholder}>
          <Ionicons name="images-outline" size={28} color={colors.neutral.placeholder} />
          <Text style={styles.photosText}>No photos attached</Text>
        </View>

        {status === 'Available' ? (
          <View style={styles.actionRow}>
            <Pressable style={styles.declineBtn}>
              <Text style={styles.declineBtnText}>Decline</Text>
            </Pressable>
            <Pressable style={styles.acceptBtn} onPress={() => setStatus('Accepted')}>
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={styles.acceptBtnText}>Accept Job</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.statusActions}>
            <Text style={styles.statusLabel}>Status: {status}</Text>
            {status === 'Accepted' && (
              <Pressable style={styles.primaryBtn} onPress={() => setStatus('In Progress')}>
                <Text style={styles.primaryBtnText}>Start Job</Text>
              </Pressable>
            )}
            {status === 'In Progress' && (
              <View style={styles.actionRow}>
                <Pressable style={styles.quoteBtn} onPress={() => router.push('/vendor/jobs/quote' as never)}>
                  <Text style={styles.quoteBtnText}>Upload Quote</Text>
                </Pressable>
                <Pressable style={styles.completeBtn} onPress={() => router.push('/vendor/jobs/complete' as never)}>
                  <Text style={styles.completeBtnText}>Mark Complete</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
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
  jobHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: 14 },
  jobTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text, flex: 1, paddingRight: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  listBorder: { borderTopWidth: 1, borderTopColor: colors.neutral.border },
  label: { fontSize: 13, color: colors.neutral.textMuted },
  value: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  descCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, gap: 6 },
  descLabel: { fontSize: 13, fontWeight: '700', color: colors.neutral.textMuted },
  descText: { fontSize: 14, color: colors.neutral.text, lineHeight: 22 },
  photosPlaceholder: { height: 90, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 6 },
  photosText: { fontSize: 13, color: colors.neutral.placeholder },
  actionRow: { flexDirection: 'row', gap: 12 },
  declineBtn: { flex: 1, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.neutral.border },
  declineBtnText: { fontSize: 15, fontWeight: '700', color: colors.neutral.textMuted },
  acceptBtn: { flex: 2, height: 52, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.secondary.emerald },
  acceptBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  statusActions: { gap: 12 },
  statusLabel: { fontSize: 14, fontWeight: '700', color: colors.primary.DEFAULT },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  quoteBtn: { flex: 1, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.primary.DEFAULT },
  quoteBtnText: { fontSize: 14, fontWeight: '700', color: colors.primary.DEFAULT },
  completeBtn: { flex: 1, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondary.emerald },
  completeBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
