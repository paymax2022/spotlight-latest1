// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createAnnouncement } from '@/api/announcements.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const CATEGORIES = ['general', 'security', 'payment', 'maintenance', 'meeting', 'election', 'emergency'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const priorityColors = { low: colors.neutral.textMuted, medium: colors.secondary.DEFAULT, high: colors.secondary.amber, urgent: colors.secondary.red };

const catColors: Record<string, string> = {
  emergency: colors.secondary.red, security: '#f97316', payment: colors.secondary.DEFAULT,
  meeting: colors.primary.DEFAULT, maintenance: colors.secondary.amber, general: colors.neutral.textMuted, election: colors.secondary.emerald,
};

export default function CreateAnnouncement() {
  const router = useRouter();
  const { estateId } = getActiveEstateContext();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<typeof CATEGORIES[number]>('general');
  const [priority, setPriority] = useState<typeof PRIORITIES[number]>('medium');
  const [showConfirm, setShowConfirm] = useState(false);

  const mut = useMutation({
    mutationFn: () => createAnnouncement(estateId, { title, body, category, priority }),
    onSuccess: () => {
      Alert.alert('Success', 'Announcement published');
      qc.invalidateQueries({ queryKey: ['announcements', estateId] });
      router.back();
    },
    onError: () => Alert.alert('Error', 'Failed to publish announcement'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>New Announcement</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Live preview */}
        {title || body ? (
          <View style={[styles.previewCard, { borderLeftColor: catColors[category] ?? colors.neutral.border }]}>
            <Text style={styles.previewLabel}>Preview</Text>
            {title ? <Text style={styles.previewTitle}>{title}</Text> : null}
            {body ? <Text style={styles.previewBody} numberOfLines={2}>{body}</Text> : null}
          </View>
        ) : null}

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Title *</Text>
          <TextInput style={styles.input} placeholder="Announcement title" placeholderTextColor={colors.neutral.placeholder} value={title} onChangeText={setTitle} />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Body *</Text>
          <TextInput style={[styles.input, styles.textarea]} placeholder="Write the full announcement..." placeholderTextColor={colors.neutral.placeholder} value={body} onChangeText={setBody} multiline numberOfLines={5} textAlignVertical="top" />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Category</Text>
          <View style={styles.chipRowWrap}>
            {CATEGORIES.map(c => {
              const col = catColors[c] ?? colors.neutral.textMuted;
              return (
                <Pressable key={c} style={[styles.chip, category === c && { backgroundColor: col, borderColor: col }]} onPress={() => setCategory(c)}>
                  <Text style={[styles.chipText, category === c && { color: '#fff' }]}>{c.charAt(0).toUpperCase() + c.slice(1)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Priority</Text>
          <View style={styles.chipRow}>
            {PRIORITIES.map(p => (
              <Pressable key={p} style={[styles.chip, priority === p && { backgroundColor: priorityColors[p], borderColor: priorityColors[p] }]} onPress={() => setPriority(p)}>
                <Text style={[styles.chipText, priority === p && { color: '#fff' }]}>{p.charAt(0).toUpperCase() + p.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable style={styles.attachBtn}>
          <Ionicons name="attach-outline" size={20} color={colors.primary.DEFAULT} />
          <Text style={styles.attachText}>Add Attachment (PDF, Image)</Text>
        </Pressable>

        <Pressable
          style={[styles.primaryBtn, (!title.trim() || !body.trim() || mut.isPending) && { opacity: 0.6 }]}
          onPress={() => setShowConfirm(true)}
          disabled={!title.trim() || !body.trim() || mut.isPending}
        >
          <Text style={styles.primaryBtnText}>Publish Announcement</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={showConfirm} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Publish Announcement?</Text>
            <Text style={styles.modalBody}>This will be sent to all estate residents. Are you sure?</Text>
            <View style={styles.modalBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowConfirm(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.confirmBtn, mut.isPending && { opacity: 0.6 }]} onPress={() => { setShowConfirm(false); mut.mutate(); }} disabled={mut.isPending}>
                <Text style={styles.confirmText}>{mut.isPending ? 'Publishing...' : 'Publish'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16 },
  previewCard: { backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 14, borderLeftWidth: 4, gap: 4 },
  previewLabel: { fontSize: 11, fontWeight: '700', color: colors.neutral.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  previewTitle: { fontSize: 15, fontWeight: '700', color: colors.neutral.text },
  previewBody: { fontSize: 13, color: colors.neutral.textMuted },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  textarea: { height: 130, paddingTop: 14 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chipRowWrap: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: colors.neutral.border, backgroundColor: colors.neutral.surface },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted, textTransform: 'capitalize' },
  attachBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.neutral.border, borderStyle: 'dashed', padding: 14 },
  attachText: { fontSize: 14, color: colors.primary.DEFAULT, fontWeight: '600' },
  primaryBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%', gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.neutral.text },
  modalBody: { fontSize: 14, color: colors.neutral.textMuted, lineHeight: 22 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontWeight: '600', color: colors.neutral.textMuted },
  confirmBtn: { flex: 1, height: 46, borderRadius: 12, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  confirmText: { fontWeight: '700', color: '#fff' },
});
