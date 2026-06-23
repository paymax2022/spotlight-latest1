// @ts-nocheck
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { uploadMedicalLicence } from '@/api/telemedicine.api';

const C = {
  primary: '#059669',
  primaryDark: '#065f46',
  primaryContainer: '#d1fae5',
  secondary: '#0EA5E9',
  secondaryContainer: '#e0f2fe',
  tertiary: '#F59E0B',
  tertiaryContainer: '#fef3c7',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceVariant: '#F1F5F9',
  text: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
};

const REQUIRED_DOCS = [
  { id: 'mdcn', label: 'MDCN Licence Certificate', description: 'Medical and Dental Council of Nigeria certificate', icon: 'document-text-outline', required: true },
  { id: 'degree', label: 'Medical Degree Certificate', description: 'MBBS or equivalent medical qualification', icon: 'school-outline', required: true },
  { id: 'specialisation', label: 'Specialist Certificate', description: 'FMCP, FMCOphth, or equivalent (if applicable)', icon: 'ribbon-outline', required: false },
  { id: 'passport', label: 'Government-issued ID', description: 'National ID, passport, or driver\'s licence', icon: 'card-outline', required: true },
];

export default function UploadMedicalLicence() {
  const router = useRouter();
  const [uploadedDocs, setUploadedDocs] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: (docId: string) =>
      uploadMedicalLicence({ document_type: docId, base64: 'mock_base64_data', filename: `${docId}_cert.pdf` }),
    onSuccess: (_, docId) => {
      setUploadedDocs((prev) => ({ ...prev, [docId]: true }));
    },
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      uploadMedicalLicence({ document_type: 'final_submission', base64: '', filename: 'submit' }),
    onSuccess: () => setSubmitted(true),
  });

  const requiredUploaded = REQUIRED_DOCS.filter((d) => d.required && uploadedDocs[d.id]).length;
  const requiredTotal = REQUIRED_DOCS.filter((d) => d.required).length;
  const progress = requiredUploaded / requiredTotal;

  if (submitted) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.successContainer}>
          <View style={s.successIcon}>
            <Ionicons name="cloud-done" size={72} color={C.primary} />
          </View>
          <Text style={s.successTitle}>Documents Submitted!</Text>
          <Text style={s.successSub}>
            Your documents are under review. Our team will verify your credentials within 2-3 business days.
          </Text>
          <View style={s.timelineCard}>
            {[
              { step: 'Documents Received', done: true },
              { step: 'Identity Verification', done: false },
              { step: 'Credential Review', done: false },
              { step: 'Account Activated', done: false },
            ].map((item, i) => (
              <View key={i} style={s.timelineItem}>
                <View style={[s.timelineDot, item.done && s.timelineDotDone]}>
                  {item.done && <Ionicons name="checkmark" size={12} color="#fff" />}
                </View>
                {i < 3 && <View style={[s.timelineLine, item.done && s.timelineLineDone]} />}
                <Text style={[s.timelineText, item.done && { color: C.primary, fontWeight: '700' }]}>{item.step}</Text>
              </View>
            ))}
          </View>
          <Pressable style={s.successBtn} onPress={() => router.push('/health/onboarding/pending' as any)}>
            <Text style={s.successBtnText}>View Status</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>Upload Documents</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
        {/* Progress card */}
        <View style={s.progressCard}>
          <View style={s.progressHeader}>
            <Text style={s.progressTitle}>Verification Progress</Text>
            <Text style={s.progressCount}>{requiredUploaded}/{requiredTotal} required</Text>
          </View>
          <View style={s.progressBar}>
            <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={s.progressSub}>
            {requiredUploaded === requiredTotal
              ? '✓ All required documents uploaded — ready to submit!'
              : `${requiredTotal - requiredUploaded} required document${requiredTotal - requiredUploaded !== 1 ? 's' : ''} remaining`}
          </Text>
        </View>

        {/* Info banner */}
        <View style={s.infoBanner}>
          <Ionicons name="shield-checkmark-outline" size={18} color={C.primary} />
          <Text style={s.infoText}>All documents are encrypted and stored securely. Only our verification team will have access.</Text>
        </View>

        {/* Document upload zones */}
        <Text style={s.sectionTitle}>Required Documents</Text>
        {REQUIRED_DOCS.map((doc) => {
          const isUploaded = uploadedDocs[doc.id];
          const isUploading = uploadMutation.isPending && uploadMutation.variables === doc.id;
          return (
            <View key={doc.id} style={[s.docCard, isUploaded && s.docCardDone]}>
              <View style={[s.docIconBox, { backgroundColor: isUploaded ? C.primaryContainer : C.surfaceVariant }]}>
                <Ionicons name={isUploaded ? 'checkmark-circle' : doc.icon as any} size={22} color={isUploaded ? C.primary : C.textMuted} />
              </View>
              <View style={s.docBody}>
                <View style={s.docTitleRow}>
                  <Text style={s.docLabel}>{doc.label}</Text>
                  {!doc.required && (
                    <Text style={s.optionalTag}>Optional</Text>
                  )}
                </View>
                <Text style={s.docDesc}>{doc.description}</Text>
                {isUploaded && <Text style={s.uploadedText}>✓ Uploaded successfully</Text>}
              </View>
              <Pressable
                style={[s.uploadBtn, isUploaded && s.uploadBtnDone]}
                onPress={() => !isUploaded && uploadMutation.mutate(doc.id)}
                disabled={isUploaded || isUploading}
              >
                {isUploading ? (
                  <ActivityIndicator color={C.primary} size="small" />
                ) : isUploaded ? (
                  <Ionicons name="checkmark" size={18} color={C.primary} />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={18} color={C.primary} />
                )}
              </Pressable>
            </View>
          );
        })}

        {/* Accepted formats */}
        <View style={s.formatsCard}>
          <Text style={s.formatsTitle}>Accepted Formats</Text>
          <View style={s.formatsList}>
            {['PDF', 'JPG', 'PNG'].map((fmt) => (
              <View key={fmt} style={s.formatBadge}>
                <Text style={s.formatText}>{fmt}</Text>
              </View>
            ))}
          </View>
          <Text style={s.formatsNote}>Max file size: 10 MB per document</Text>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Submit button */}
      <View style={s.stickyFooter}>
        <Pressable
          style={[s.submitBtn, (requiredUploaded < requiredTotal || submitMutation.isPending) && { opacity: 0.5 }]}
          onPress={() => submitMutation.mutate()}
          disabled={requiredUploaded < requiredTotal || submitMutation.isPending}
        >
          {submitMutation.isPending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="send" size={18} color="#fff" />
              <Text style={s.submitBtnText}>Submit for Verification</Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 24, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  progressCard: { backgroundColor: C.surface, borderRadius: 16, padding: 16, marginTop: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  progressTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  progressCount: { fontSize: 14, color: C.primary, fontWeight: '700' },
  progressBar: { height: 8, backgroundColor: C.surfaceVariant, borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: '100%', backgroundColor: C.primary, borderRadius: 4 },
  progressSub: { fontSize: 12, color: C.textMuted },
  infoBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: C.primaryContainer, borderRadius: 12, padding: 14, marginBottom: 20 },
  infoText: { flex: 1, fontSize: 13, color: C.primaryDark, lineHeight: 19 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 12 },
  docCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  docCardDone: { borderColor: C.primary, backgroundColor: '#f0fdf4' },
  docIconBox: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  docBody: { flex: 1 },
  docTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  docLabel: { fontSize: 13, fontWeight: '700', color: C.text, flex: 1 },
  optionalTag: { fontSize: 10, color: C.textMuted, fontWeight: '600', backgroundColor: C.surfaceVariant, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 100 },
  docDesc: { fontSize: 12, color: C.textMuted, lineHeight: 17 },
  uploadedText: { fontSize: 12, color: C.primary, fontWeight: '600', marginTop: 4 },
  uploadBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.primaryContainer, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  uploadBtnDone: { backgroundColor: '#dcfce7' },
  formatsCard: { backgroundColor: C.surfaceVariant, borderRadius: 14, padding: 14, marginTop: 8 },
  formatsTitle: { fontSize: 13, fontWeight: '700', color: C.text, marginBottom: 10 },
  formatsList: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  formatBadge: { backgroundColor: C.surface, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  formatText: { fontSize: 12, fontWeight: '700', color: C.textMuted },
  formatsNote: { fontSize: 11, color: C.textMuted },
  stickyFooter: { padding: 16, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border },
  submitBtn: { backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 14, gap: 8 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successIcon: { marginBottom: 16 },
  successTitle: { fontSize: 26, fontWeight: '800', color: C.text, marginBottom: 10 },
  successSub: { fontSize: 14, color: C.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  timelineCard: { backgroundColor: C.surface, borderRadius: 16, padding: 16, width: '100%', marginBottom: 24 },
  timelineItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  timelineDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  timelineDotDone: { backgroundColor: C.primary },
  timelineLine: { position: 'absolute', left: 11, top: 24, width: 2, height: 16, backgroundColor: C.border },
  timelineLineDone: { backgroundColor: C.primary },
  timelineText: { fontSize: 14, color: C.textMuted },
  successBtn: { backgroundColor: C.primary, paddingHorizontal: 32, paddingVertical: 16, borderRadius: 14 },
  successBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
