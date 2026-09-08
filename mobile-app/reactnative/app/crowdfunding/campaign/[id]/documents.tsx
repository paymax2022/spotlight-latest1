import React, { useState } from 'react';
import { FlatList, View, Text, Pressable, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { FileText, Image as ImageIcon, BadgeCheck, Download, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';
import * as DocumentPicker from 'expo-document-picker';
import { useAuthStore } from '@/store/authStore';
import { uploadCampaignDocument, attachCampaignDocument } from '@/features/crowdfunding/api/documentUpload';

export default function DocumentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading, isError, refetch } = useCampaign(id);
  const user = useAuthStore((st) => st.user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the creator may attach — the server enforces it too, but showing the
  // control to a backer would offer an action that can only ever fail.
  const isCreator = !!user?.id && !!c?.creator?.id && user.id === c.creator.id;

  const addDocument = async () => {
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];
    setBusy(true);
    try {
      const upload = await uploadCampaignDocument({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
      });
      // The file's own name is the label unless the creator renames it later —
      // better than an empty row, and it is what they just chose.
      await attachCampaignDocument(id!, asset.name.replace(/\.[^.]+$/, ''), upload);
      await refetch();
    } catch (e) {
      // Surface the reason. A silent failure here looks identical to a picker the
      // user dismissed.
      setError(e instanceof Error ? e.message : 'Could not attach that document');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Documents"
        subtitle="Supporting evidence for this campaign"
        rightSlot={
          isCreator ? (
            busy ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Pressable onPress={addDocument} hitSlop={8} accessibilityLabel="Add a document">
                <Plus size={22} color={Colors.primary} strokeWidth={2.2} />
              </Pressable>
            )
          ) : undefined
        }
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !c ? (
        <StateView kind="error" title="Couldn't load documents" actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={c.documents}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`${item.label}, ${item.sizeLabel}`}>
              <View style={styles.iconBox}>
                {item.type === 'pdf' ? <FileText size={20} color={Colors.secondary} strokeWidth={2} /> : <ImageIcon size={20} color={Colors.secondary} strokeWidth={2} />}
              </View>
              <View style={styles.body}>
                <View style={styles.titleRow}>
                  <Text style={styles.label} numberOfLines={1}>{item.label}</Text>
                  {item.verified && <BadgeCheck size={15} color={Colors.tertiaryContainer} strokeWidth={2.2} />}
                </View>
                <Text style={styles.meta}>{item.type.toUpperCase()} · {item.sizeLabel}</Text>
              </View>
              <Download size={18} color={Colors.outline} strokeWidth={2} />
            </Pressable>
          )}
          ListEmptyComponent={
            <StateView kind="empty" icon="FolderOpen" title="No documents" message="The creator hasn't attached supporting documents." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  error: { ...Typography.bodySm, color: Colors.error, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xs },
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.sm, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
