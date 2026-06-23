// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function MarkComplete() {
  const router = useRouter();
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<boolean[]>([false, false, false]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Mark Complete</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.jobSummary}>
          <Ionicons name="checkmark-circle" size={20} color={colors.secondary.emerald} />
          <View>
            <Text style={styles.jobTitle}>Electrical panel repair</Text>
            <Text style={styles.jobSub}>Green Estate · Job #1042</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Completion Photos (Required)</Text>
        <View style={styles.photoGrid}>
          {photos.map((uploaded, i) => (
            <Pressable key={i} style={[styles.photoBox, uploaded && { borderColor: colors.secondary.emerald }]} onPress={() => setPhotos(p => p.map((v, j) => j === i ? true : v))}>
              {uploaded ? (
                <>
                  <Ionicons name="image" size={28} color={colors.secondary.emerald} />
                  <Text style={[styles.photoLabel, { color: colors.secondary.emerald }]}>Photo {i + 1}</Text>
                </>
              ) : (
                <>
                  <Ionicons name="camera-outline" size={28} color={colors.neutral.placeholder} />
                  <Text style={styles.photoLabel}>Add Photo {i + 1}</Text>
                </>
              )}
            </Pressable>
          ))}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Work Description</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Describe the work completed..."
            placeholderTextColor={colors.neutral.placeholder}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        <Pressable style={[styles.primaryBtn, { backgroundColor: colors.secondary.emerald }]}>
          <Ionicons name="checkmark-circle" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Submit Completion</Text>
        </Pressable>
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
  jobSummary: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14 },
  jobTitle: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  jobSub: { fontSize: 12, color: colors.neutral.textMuted },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  photoGrid: { flexDirection: 'row', gap: 10 },
  photoBox: { flex: 1, height: 90, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 2, borderColor: colors.neutral.border, borderStyle: 'dashed' },
  photoLabel: { fontSize: 11, color: colors.neutral.placeholder },
  fieldGroup: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  textarea: { height: 110, paddingTop: 14 },
  primaryBtn: { borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
