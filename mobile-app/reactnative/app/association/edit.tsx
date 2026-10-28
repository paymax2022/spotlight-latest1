'use client';
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Check } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import StateView from '@/components/StateView';
import { useDashboard } from '@/features/association/hooks';
import { alertAsync, confirmAsync } from '@/lib/confirm';

interface EditFormData {
  name: string;
  description?: string;
  acronym?: string;
}

export default function EditOrgPage() {
  const dash = useDashboard();
  const [formData, setFormData] = useState<EditFormData>({
    name: dash.data?.card.organisationName ?? '',
    description: dash.data?.card.organisationDescription ?? '',
    acronym: dash.data?.card.organisationAcronym ?? '',
  });
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!formData.name.trim()) {
      await alertAsync({
        title: 'Name required',
        message: 'Organization name cannot be empty.',
      });
      return;
    }

    const confirmed = await confirmAsync({
      title: 'Save changes?',
      message: 'Update the organization details?',
      confirmLabel: 'Save',
    });

    if (!confirmed) return;

    setIsSaving(true);
    try {
      const response = await fetch('/api/finance/associations/me/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description?.trim() || null,
          acronym: formData.acronym?.trim() || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to save organization details');
      }

      await alertAsync({
        title: 'Saved',
        message: 'Organization details updated successfully.',
      });

      dash.refetch();
      goBack('/association');
    } catch (error) {
      await alertAsync({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to save changes.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!dash.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StateView kind="loading" message="Loading organization details…" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/association/home')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back">
          <ArrowLeft size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.eyebrow}>Edit Organization</Text>
          <Text style={styles.headerTitle}>Organization Details</Text>
        </View>
        <Pressable
          onPress={handleSave}
          disabled={isSaving}
          hitSlop={10}
          style={[styles.iconBtn, isSaving && styles.iconBtnDisabled]}
          accessibilityLabel="Save changes"
        >
          <Check size={22} color={Colors.primary} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.formSection}>
          <Text style={styles.label}>Organization Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter organization name"
            value={formData.name}
            onChangeText={(text) => setFormData({ ...formData, name: text })}
            editable={!isSaving}
            placeholderTextColor={Colors.outline}
          />
          <Text style={styles.hint}>The official name of your organization</Text>
        </View>

        <View style={styles.formSection}>
          <Text style={styles.label}>Acronym</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., NGO, ASSOC"
            value={formData.acronym}
            onChangeText={(text) => setFormData({ ...formData, acronym: text })}
            editable={!isSaving}
            placeholderTextColor={Colors.outline}
            maxLength={10}
          />
          <Text style={styles.hint}>Short abbreviation (max 10 characters)</Text>
        </View>

        <View style={styles.formSection}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            placeholder="Describe your organization"
            value={formData.description}
            onChangeText={(text) => setFormData({ ...formData, description: text })}
            editable={!isSaving}
            placeholderTextColor={Colors.outline}
            multiline
            numberOfLines={5}
          />
          <Text style={styles.hint}>A brief description of what your organization does</Text>
        </View>

        <Pressable
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
        >
          <Text style={styles.saveButtonText}>{isSaving ? 'Saving…' : 'Save Changes'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  iconBtnDisabled: { opacity: 0.5 },
  headerTitleWrap: { flex: 1 },
  eyebrow: { ...Typography.caption, color: Colors.primary, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.6 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 80, gap: Spacing.lg },
  formSection: { marginVertical: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs, fontWeight: '600' as const },
  input: {
    ...Typography.bodyMd,
    borderWidth: 1,
    borderColor: Colors.outline,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    color: Colors.onSurface,
    backgroundColor: Colors.surfaceContainerLow,
    marginBottom: Spacing.sm,
  },
  textarea: { textAlignVertical: 'top', minHeight: 120 },
  hint: { ...Typography.caption, color: Colors.outline, marginTop: Spacing.xs },
  saveButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    marginTop: Spacing.lg,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { ...Typography.labelLg, color: Colors.onPrimary, fontWeight: '600' as const },
});
