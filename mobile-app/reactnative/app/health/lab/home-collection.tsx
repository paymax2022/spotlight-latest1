import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { MapPin, Calendar, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { COLLECTION_WINDOWS } from '@/features/health/lab/constants';

export default function HomeCollectionScreen() {
  const params = useLocalSearchParams();
  const [address, setAddress] = useState('12B Ozumba Mbadiwe Ave, Victoria Island, Lagos');
  const [window, setWindow] = useState<string | null>(COLLECTION_WINDOWS[0]);

  const onContinue = () => {
    router.push({
      pathname: '/health/lab/checkout',
      params: { ...params, location: address, scheduledFor: window ?? '' },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Schedule collection" subtitle="A phlebotomist will visit you" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Address */}
        <Text style={styles.sectionTitle}>Collection address</Text>
        <View style={[styles.addrCard, shadow1]}>
          <MapPin size={18} color={Colors.secondary} strokeWidth={2} />
          <TextInputField
            value={address}
            onChangeText={setAddress}
            placeholder="Enter your full address"
            multiline
            style={styles.addrInput}
          />
        </View>

        {/* Time windows */}
        <Text style={styles.sectionTitle}>Pick a time window</Text>
        <View style={styles.windows}>
          {COLLECTION_WINDOWS.map((w) => {
            const sel = w === window;
            return (
              <Pressable key={w} style={[styles.window, sel && styles.windowSel]} onPress={() => setWindow(w)}>
                <Clock size={16} color={sel ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={[styles.windowText, sel && styles.windowTextSel]}>{w}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.note}>
          <Calendar size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.noteText}>
            You can reschedule up to 1 hour before your window. Please ensure any fasting requirements are met before the visit.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Continue to payment" onPress={onContinue} disabled={!window || !address.trim()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  addrCard: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'flex-start' },
  addrInput: { flex: 1, minHeight: 44, textAlignVertical: 'top' },
  windows: { gap: Spacing.sm },
  window: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    padding: Spacing.md,
  },
  windowSel: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  windowText: { ...Typography.labelLg, color: Colors.onSurfaceVariant },
  windowTextSel: { color: Colors.onSurface },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  noteText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
