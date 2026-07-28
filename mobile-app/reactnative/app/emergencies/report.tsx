import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Icons from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { KIND_META } from '@/features/emergencies/api';
import { useCreateEmergency } from '@/features/emergencies/hooks';
import type { EmergencyKind } from '@/features/emergencies/api';

const KINDS: EmergencyKind[] = ['panic', 'medical', 'fire', 'security', 'noise', 'theft', 'domestic', 'other'];

export default function ReportEmergencyScreen() {
  const create = useCreateEmergency();
  const [kind, setKind] = useState<EmergencyKind>('panic');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');

  const submit = () => {
    create.mutate({ kind, description: description.trim() || undefined, location: location.trim() || undefined }, {
      onSuccess: () => router.replace('/emergencies'),
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Report emergency" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Type</Text>
          <View style={styles.grid}>
            {KINDS.map((k) => {
              const selected = k === kind; const meta = KIND_META[k];
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.TriangleAlert;
              return (
                <Pressable key={k} onPress={() => setKind(k)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.tile, selected && styles.tileSel]}>
                  <Icon size={22} color={selected ? Colors.onError : Colors.error} strokeWidth={1.8} />
                  <Text style={[styles.tileText, selected && { color: Colors.onError }]}>{meta.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <TextInputField label="Location (optional)" placeholder="e.g. Block A, Gate B" value={location} onChangeText={setLocation} />
          <TextInputField label="What's happening? (optional)" placeholder="Briefly describe the situation" value={description} onChangeText={setDescription} multiline numberOfLines={3} style={styles.multiline} />
          <View style={styles.note}><Text style={styles.noteText}>This immediately alerts estate security and admin. For life-threatening emergencies, also call the appropriate emergency service.</Text></View>
        </ScrollView>
        <View style={styles.footer}><PrimaryButton label="Send alert" onPress={submit} loading={create.isPending} variant="danger" /></View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { width: '23%', flexGrow: 1, alignItems: 'center', gap: 4, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
  tileSel: { backgroundColor: Colors.error, borderColor: Colors.error },
  tileText: { ...Typography.labelSm, color: Colors.onSurface },
  multiline: { minHeight: 76, textAlignVertical: 'top', paddingTop: Spacing.sm },
  note: { backgroundColor: Colors.errorContainer, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  noteText: { ...Typography.bodySm, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow },
});
