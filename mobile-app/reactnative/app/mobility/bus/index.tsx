import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { BusFront, MapPin, Ticket, ArrowDownUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { BUS_ENABLED } from '@/features/mobility/constants/modes.constants';

export default function BusHomeScreen() {
  const [origin, setOrigin] = useState('Lagos');
  const [dest, setDest] = useState('Abuja');
  const today = new Date();
  const [date, setDate] = useState(today.toISOString().slice(0, 10));

  if (!BUS_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Book a bus" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  const swap = () => { setOrigin(dest); setDest(origin); };
  const onSearch = () => {
    if (!origin.trim() || !dest.trim()) return;
    router.push({ pathname: '/mobility/bus/results', params: { origin: origin.trim(), dest: dest.trim(), date } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Book a bus"
        rightSlot={
          <Pressable onPress={() => router.push('/mobility/bus/tickets')} hitSlop={8} accessibilityLabel="My tickets">
            <Ticket size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.hero, shadow1]}>
          <View style={styles.heroIcon}><BusFront size={24} color={Colors.primary} strokeWidth={2.2} /></View>
          <Text style={styles.heroTitle}>Intercity & intracity travel</Text>
          <Text style={styles.heroSub}>Compare operators, pick your seat, and travel with a QR boarding pass.</Text>
        </View>

        <View style={styles.searchCard}>
          <View style={styles.fieldRow}>
            <View style={{ flex: 1 }}>
              <TextInputField label="From" value={origin} onChangeText={setOrigin} placeholder="Origin city" leftIcon={<MapPin size={18} color={Colors.secondary} strokeWidth={2} />} />
            </View>
          </View>
          <Pressable style={styles.swapBtn} onPress={swap} accessibilityLabel="Swap cities"><ArrowDownUp size={18} color={Colors.primary} strokeWidth={2} /></Pressable>
          <TextInputField label="To" value={dest} onChangeText={setDest} placeholder="Destination city" leftIcon={<MapPin size={18} color={Colors.primary} strokeWidth={2} />} />
          <TextInputField label="Travel date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Search buses" onPress={onSearch} disabled={!origin.trim() || !dest.trim()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  hero: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: 6 },
  heroIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.titleMd, color: Colors.onSurface },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  searchCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  fieldRow: { flexDirection: 'row' },
  swapBtn: { alignSelf: 'flex-end', width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm, marginTop: -Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
