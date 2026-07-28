import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, Image, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ImagePlus, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { usePostUpdate } from '@/features/crowdfunding/hooks/useExtras';
import { pickFromLibrary } from '@/features/crowdfunding/utils/mediaPicker';

export default function PostUpdateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const post = usePostUpdate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const addImage = async () => {
    const asset = await pickFromLibrary({ kind: 'images', allowsEditing: true });
    if (asset) setImageUri(asset.uri);
  };

  const submit = () => {
    post.mutate({ campaignId: id, title: title.trim(), body: body.trim(), imageUri }, { onSuccess: () => setDone(true) });
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Update posted" showBack={false} />
        <StateView kind="empty" icon="CircleCheck" title="Update published 🎉" message="Your backers have been notified. Regular updates keep supporters engaged and build trust." actionLabel="Done" onAction={() => router.dismissTo(`/crowdfunding/campaign/${id}/updates`)} />
      </SafeAreaView>
    );
  }

  const valid = title.trim().length > 3 && body.trim().length > 10;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Post an update" subtitle="Keep your backers in the loop" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <TextInputField label="Update title" placeholder="e.g. Surgery date confirmed!" value={title} onChangeText={setTitle} />

          <Text style={styles.label}>What's the news?</Text>
          <TextInput style={styles.editor} placeholder="Share progress, milestones, or a thank-you…" placeholderTextColor={Colors.outline} value={body} onChangeText={setBody} multiline textAlignVertical="top" />

          <Text style={[styles.label, { marginTop: Spacing.lg }]}>Photo (optional)</Text>
          {imageUri ? (
            <View style={styles.imageWrap}>
              <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
              <Pressable style={styles.imageRemove} onPress={() => setImageUri(null)} accessibilityLabel="Remove photo"><X size={16} color={Colors.white} strokeWidth={2.4} /></Pressable>
            </View>
          ) : (
            <Pressable style={styles.addImage} onPress={addImage} accessibilityRole="button" accessibilityLabel="Add a photo">
              <ImagePlus size={24} color={Colors.primary} strokeWidth={1.8} />
              <Text style={styles.addImageText}>Add a photo</Text>
            </Pressable>
          )}
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Publish update" onPress={submit} disabled={!valid} loading={post.isPending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  editor: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, minHeight: 140, ...Typography.bodyMd, color: Colors.onSurface },
  imageWrap: { position: 'relative' },
  image: { width: '100%', height: 180, borderRadius: Radius.lg },
  imageRemove: { position: 'absolute', top: Spacing.sm, right: Spacing.sm, width: 30, height: 30, borderRadius: Radius.full, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  addImage: { height: 120, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow },
  addImageText: { ...Typography.labelMd, color: Colors.primary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
