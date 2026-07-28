// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

const DOC_CATEGORIES = ['Estate Constitution', 'Community Rules', 'Service Charge', 'Meeting Minutes', 'Election Docs', 'Property Docs', 'Lease Docs', 'Payment Receipts'];
const ACCESS_LEVELS = ['Public', 'Members', 'Admin Only'];

export default function UploadDocumentScreen() {
  const router = useRouter();
  const [category, setCategory] = useState('');
  const [name, setName] = useState('');
  const [access, setAccess] = useState('Members');
  const [hasFile, setHasFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const mutation = useMutation({
    mutationFn: async () => {
      // Simulate upload progress
      for (let i = 0; i <= 100; i += 20) {
        await new Promise((r) => setTimeout(r, 200));
        setUploadProgress(i);
      }
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: category.toLowerCase().replace(/ /g, '_'), name, access_level: access.toLowerCase().replace(/ /g, '_') }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      Alert.alert('Uploaded', 'Document uploaded successfully.', [{ text: 'OK', onPress: () => router.back() }]);
    },
    onError: () => { setUploadProgress(0); Alert.alert('Error', 'Upload failed.'); },
  });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Upload Document</Text>
        <View style={{ width: 38 }} />
      </View>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.label}>Category</Text>
        <View style={s.categoryGrid}>
          {DOC_CATEGORIES.map((c) => (
            <Pressable key={c} style={[s.catChip, category === c && s.catChipActive]} onPress={() => setCategory(c)}>
              <Text style={[s.catChipTxt, category === c && s.catChipTxtActive]} numberOfLines={1}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.label}>Document Name</Text>
        <TextInput style={s.input} placeholder="Enter document name..." placeholderTextColor={colors.neutral.placeholder} value={name} onChangeText={setName} />

        <Text style={s.label}>Access Level</Text>
        <View style={s.accessRow}>
          {ACCESS_LEVELS.map((a) => (
            <Pressable key={a} style={[s.accessChip, access === a && s.accessChipActive]} onPress={() => setAccess(a)}>
              <Text style={[s.accessChipTxt, access === a && s.accessChipTxtActive]}>{a}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={[s.uploadArea, hasFile && s.uploadAreaActive]} onPress={() => setHasFile(true)}>
          <Ionicons name="cloud-upload-outline" size={40} color={hasFile ? colors.primary.DEFAULT : colors.neutral.placeholder} />
          <Text style={[s.uploadTxt, hasFile && { color: colors.primary.DEFAULT }]}>
            {hasFile ? 'File selected' : 'Tap to select file'}
          </Text>
          <Text style={s.uploadHint}>PDF, DOC, JPG up to 10MB</Text>
        </Pressable>

        {mutation.isPending && (
          <View style={s.progressBar}>
            <View style={[s.progressFill, { width: `${uploadProgress}%` }]} />
          </View>
        )}

        <Pressable
          style={[s.submitBtn, (!category || !name || !hasFile || mutation.isPending) && { opacity: 0.5 }]}
          onPress={() => mutation.mutate()}
          disabled={!category || !name || !hasFile || mutation.isPending}
        >
          <Text style={s.submitBtnTxt}>{mutation.isPending ? `Uploading ${uploadProgress}%…` : 'Upload Document'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.neutral.border, backgroundColor: colors.neutral.surface },
  catChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  catChipTxt: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '500' },
  catChipTxtActive: { color: '#fff', fontWeight: '700' },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  accessRow: { flexDirection: 'row', gap: 10 },
  accessChip: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.neutral.border, alignItems: 'center' },
  accessChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  accessChipTxt: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '500' },
  accessChipTxtActive: { color: '#fff', fontWeight: '700' },
  uploadArea: { height: 140, borderRadius: 14, borderWidth: 2, borderColor: colors.neutral.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.neutral.surface },
  uploadAreaActive: { borderColor: colors.primary.DEFAULT, backgroundColor: colors.neutral.surfaceAlt },
  uploadTxt: { fontSize: 15, fontWeight: '600', color: colors.neutral.textMuted },
  uploadHint: { fontSize: 12, color: colors.neutral.placeholder },
  progressBar: { height: 6, backgroundColor: colors.neutral.border, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: colors.primary.DEFAULT, borderRadius: 3 },
  submitBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  submitBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
