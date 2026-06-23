import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';

export default function BusPassengerScreen() {
  const { scheduleId, seat } = useLocalSearchParams<{ scheduleId: string; seat: string }>();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const canContinue = name.trim().length > 1 && phone.trim().length >= 7;
  const onContinue = () => {
    if (!canContinue || !scheduleId) return;
    router.push({ pathname: '/mobility/bus/review', params: { scheduleId, seat, name: name.trim(), phone: phone.trim() } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Passenger details" subtitle={`Seat ${seat}`} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.note}>Enter the details of the person travelling. Their name will appear on the ticket and boarding pass.</Text>
          <TextInputField label="Full name" value={name} onChangeText={setName} placeholder="Passenger name" autoCapitalize="words" />
          <TextInputField label="Phone number" value={phone} onChangeText={setPhone} placeholder="+234…" keyboardType="phone-pad" />
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Review booking" onPress={onContinue} disabled={!canContinue} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  note: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22, marginBottom: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
