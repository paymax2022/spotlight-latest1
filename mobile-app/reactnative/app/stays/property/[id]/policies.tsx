import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Clock, LogOut, Ban, Baby, Dog, Cigarette, BedDouble } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useProperty } from '@/features/stays/hooks';
import { StaysColors } from '@/features/stays/constants/stays.constants';

export default function PoliciesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const prop = useProperty(String(id));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Policies & house rules" subtitle={prop.data?.name} />
      {prop.isLoading ? (
        <StateView kind="loading" message="Loading policies…" />
      ) : prop.isError || !prop.data ? (
        <StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => prop.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Row icon={<Clock size={18} color={StaysColors.brand} />} title="Check-in" value={prop.data.policies.checkIn} />
          <Row icon={<LogOut size={18} color={StaysColors.brand} />} title="Check-out" value={prop.data.policies.checkOut} />
          <Row icon={<Ban size={18} color={StaysColors.brand} />} title="Cancellation" value={prop.data.policies.cancellation} />
          <Row icon={<Baby size={18} color={StaysColors.brand} />} title="Children" value={prop.data.policies.children} />
          <Row icon={<Dog size={18} color={StaysColors.brand} />} title="Pets" value={prop.data.policies.pets} />
          <Row icon={<Cigarette size={18} color={StaysColors.brand} />} title="Smoking" value={prop.data.policies.smoking} />
          <Row icon={<BedDouble size={18} color={StaysColors.brand} />} title="Extra beds" value={prop.data.policies.extraBeds} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.iconBox}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  row: { flexDirection: 'row', gap: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  iconBox: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  value: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
});
