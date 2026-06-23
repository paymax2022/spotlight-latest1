import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { UploadCloud, FileCheck2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';

export type UploadFieldState = 'empty' | 'selected' | 'uploading' | 'uploaded' | 'error';

interface Props {
  label:        string;
  required?:    boolean;
  state:        UploadFieldState;
  fileName?:    string;       // shown once a file is selected / uploaded
  hint?:        string;       // helper copy under the row
  errorText?:   string;
  onPick:       () => void;   // pick (stub) a file
  onUpload?:    () => void;   // confirm upload of the selected file
  onRetry?:     () => void;
}

// New component: a document/photo upload row with empty / selected / uploading /
// uploaded / error states. The Phase A flow stubs the file picker (no real
// DocumentPicker), so this renders the chosen-file affordance and drives the
// upload mutation. DrugItemRow is prescription-specific; no existing component
// models an upload slot, so this is genuinely new.
export default function UploadField({
  label, required, state, fileName, hint, errorText, onPick, onUpload, onRetry,
}: Props) {
  const isUploaded  = state === 'uploaded';
  const isError     = state === 'error';
  const isUploading = state === 'uploading';
  const hasFile     = state === 'selected' || isUploading || isUploaded;

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.req}>{required ? 'Required' : 'Optional'}</Text>
      </View>

      <Pressable
        onPress={isUploading ? undefined : onPick}
        disabled={isUploading}
        style={[
          styles.dropzone,
          hasFile && styles.dropzoneFilled,
          isUploaded && styles.dropzoneDone,
          isError && styles.dropzoneError,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Upload ${label}`}
      >
        <View style={[styles.iconBox, isUploaded && styles.iconBoxDone, isError && styles.iconBoxError]}>
          {isUploading
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : isUploaded
            ? <CheckCircle2 size={20} color={Colors.teal} strokeWidth={2} />
            : isError
            ? <AlertCircle size={20} color={Colors.error} strokeWidth={2} />
            : hasFile
            ? <FileCheck2 size={20} color={Colors.primary} strokeWidth={2} />
            : <UploadCloud size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />}
        </View>
        <View style={styles.body}>
          <Text style={styles.fileName} numberOfLines={1}>
            {hasFile && fileName ? fileName : 'Tap to choose a file'}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {isUploading ? 'Uploading…'
              : isUploaded ? 'Uploaded'
              : isError ? (errorText ?? 'Upload failed')
              : hasFile ? 'Ready to upload'
              : (hint ?? 'PDF, JPG or PNG')}
          </Text>
        </View>
      </Pressable>

      {state === 'selected' && onUpload && (
        <Pressable onPress={onUpload} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel={`Upload ${label} now`}>
          <UploadCloud size={16} color={Colors.primary} strokeWidth={2.2} />
          <Text style={styles.actionText}>Upload now</Text>
        </Pressable>
      )}

      {isError && onRetry && (
        <Pressable onPress={onRetry} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel={`Retry ${label}`}>
          <RefreshCw size={16} color={Colors.primary} strokeWidth={2.2} />
          <Text style={styles.actionText}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:           { marginBottom: Spacing.md },
  labelRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xs },
  label:          { ...Typography.labelMd, color: Colors.onSurface },
  req:            { ...Typography.caption, color: Colors.onSurfaceVariant },
  dropzone:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 64, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow },
  dropzoneFilled: { borderStyle: 'solid', borderColor: Colors.primary, backgroundColor: Colors.primaryFixed },
  dropzoneDone:   { borderStyle: 'solid', borderColor: Colors.teal, backgroundColor: Colors.iconBgTeal },
  dropzoneError:  { borderStyle: 'solid', borderColor: Colors.error, backgroundColor: Colors.errorContainer },
  iconBox:        { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLowest },
  iconBoxDone:    { backgroundColor: Colors.surfaceContainerLowest },
  iconBoxError:   { backgroundColor: Colors.surfaceContainerLowest },
  body:           { flex: 1, gap: 2 },
  fileName:       { ...Typography.labelMd, color: Colors.onSurface },
  meta:           { ...Typography.caption, color: Colors.onSurfaceVariant },
  actionBtn:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, alignSelf: 'flex-start', marginTop: Spacing.sm, paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.primaryFixed },
  actionText:     { ...Typography.labelMd, color: Colors.primary },
});
