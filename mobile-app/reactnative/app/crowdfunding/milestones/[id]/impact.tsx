import React, { useState } from 'react';
import { ScrollView, View, Text, Image, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ImagePlus, Plus, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { TextInput } from 'react-native';
import { pickMultipleFromLibrary } from '@/features/crowdfunding/utils/mediaPicker';

export default function ImpactReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const addPhotos = async () => {
    const remaining = 6 - photos.length;
    if (remaining <= 0) return;
    const assets = await pickMultipleFromLibrary(remaining);
    if (assets.length) setPhotos((prev) => [...prev, ...assets.map((a) => a.uri)]);
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Impact report" showBack={false} />
        <StateView kind="empty" icon="CircleCheck" title="Impact report published" message="Your supporters can now see how their contributions made a difference. Transparency builds repeat support." actionLabel="Done" onAction={() => router.dismissTo(`/crowdfunding/milestones/${id}`)} />
      </SafeAreaView>
    );
  }

  const valid = title.trim().length > 3 && body.trim().length > 20;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create impact report" subtitle="Show supporters the difference" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <TextInputField label="Report title" placeholder="e.g. Borehole complete — clean water flowing" value={title} onChangeText={setTitle} />

          <Text style={styles.label}>What was achieved?</Text>
          <TextInput style={styles.editor} placeholder="Describe the impact and how funds were used…" placeholderTextColor={Colors.outline} value={body} onChangeText={setBody} multiline textAlignVertical="top" />

          <Text style={[styles.label, { marginTop: Spacing.lg }]}>Impact photos</Text>
          <View style={styles.photoRow}>
            {photos.map((uri, i) => (
              <View key={uri} style={styles.photo}>
                <Image source={{ uri }} style={styles.photoImg} resizeMode="cover" />
                <Pressable style={styles.photoRemove} onPress={() => setPhotos(photos.filter((_, idx) => idx !== i))} accessibilityLabel="Remove photo"><X size={11} color={Colors.white} strokeWidth={2.6} /></Pressable>
              </View>
            ))}
            {photos.length < 6 && (
              <Pressable style={styles.addPhoto} onPress={addPhotos} accessibilityRole="button" accessibilityLabel="Add photos"><ImagePlus size={20} color={Colors.primary} strokeWidth={2} /></Pressable>
            )}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Publish impact report" onPress={() => setDone(true)} disabled={!valid} />
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
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  photo: { width: 80, height: 80, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
  addPhoto: { width: 80, height: 80, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
