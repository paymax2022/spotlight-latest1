import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useOnboardVendor } from '@/features/vendors/hooks';
import { VENDOR_CATEGORY_META } from '@/features/vendors/api';

export default function VendorOnboardScreen() {
  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState('general');
  const [phone, setPhone] = useState('');
  const [specialties, setSpecialties] = useState('');
  const onboard = useOnboardVendor();

  const categories = Object.keys(VENDOR_CATEGORY_META);
  const canSubmit = businessName.trim().length >= 2 && !onboard.isPending;

  const onSubmit = () => {
    onboard.mutate(
      {
        businessName: businessName.trim(),
        category,
        phone: phone.trim() || undefined,
        specialties: specialties.split(',').map((s) => s.trim()).filter(Boolean),
      },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Become a vendor" subtitle="Register your business" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <TextInputField label="Business name" value={businessName} onChangeText={setBusinessName} placeholder="e.g. Chukwu Plumbing Works" />

          <Text style={styles.label}>Category</Text>
          <View style={styles.chips}>
            {categories.map((c) => {
              const active = c === category;
              return (
                <Text
                  key={c}
                  onPress={() => setCategory(c)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  {VENDOR_CATEGORY_META[c].label}
                </Text>
              );
            })}
          </View>

          <TextInputField label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="+234…" keyboardType="phone-pad" />
          <TextInputField label="Specialties (comma-separated)" value={specialties} onChangeText={setSpecialties} placeholder="e.g. leaks, water heaters" />

          <Text style={styles.hint}>You'll be listed as “pending” until an estate admin verifies your business.</Text>
          {onboard.isError ? <Text style={styles.error}>Couldn't submit. Please try again.</Text> : null}
          <PrimaryButton label={onboard.isPending ? 'Submitting…' : 'Submit application'} onPress={onSubmit} loading={onboard.isPending} disabled={!canSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { padding: Spacing.containerMargin, gap: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { ...Typography.labelMd, color: Colors.onSurfaceVariant, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 7, overflow: 'hidden' },
  chipActive: { color: Colors.onPrimary, backgroundColor: Colors.primary },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodySm, color: Colors.error },
});
