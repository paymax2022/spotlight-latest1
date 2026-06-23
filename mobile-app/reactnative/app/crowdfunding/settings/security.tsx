import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { KeyRound, Fingerprint, ShieldCheck, Smartphone, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';

const INITIAL_DEVICES = [
  { id: 'd1', name: 'iPhone 15 · Lagos', current: true, lastSeen: 'Active now' },
  { id: 'd2', name: 'Pixel 7 · Enugu', current: false, lastSeen: '2 days ago' },
];

export default function SecuritySettings() {
  const [biometric, setBiometric] = useState(true);
  const [twoFa, setTwoFa] = useState(false);
  const [devices, setDevices] = useState(INITIAL_DEVICES);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Security" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Pressable style={[styles.row, styles.rowBorder]} onPress={() => router.push('/crowdfunding/settings/change-password')} accessibilityRole="button" accessibilityLabel="Change password">
            <View style={styles.rowIcon}><KeyRound size={18} color={Colors.primary} strokeWidth={2} /></View>
            <View style={styles.rowBody}><Text style={styles.label}>Change password</Text><Text style={styles.sub}>Last changed 3 months ago</Text></View>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>

          <View style={[styles.row, styles.rowBorder]}>
            <View style={styles.rowIcon}><Fingerprint size={18} color={Colors.primary} strokeWidth={2} /></View>
            <View style={styles.rowBody}><Text style={styles.label}>Biometric login</Text><Text style={styles.sub}>Face ID / fingerprint</Text></View>
            <Toggle on={biometric} onToggle={() => setBiometric((v) => !v)} />
          </View>

          <View style={styles.row}>
            <View style={styles.rowIcon}><ShieldCheck size={18} color={Colors.primary} strokeWidth={2} /></View>
            <View style={styles.rowBody}><Text style={styles.label}>Two-factor authentication</Text><Text style={styles.sub}>{twoFa ? 'Enabled' : 'Add an extra layer of security'}</Text></View>
            <Toggle on={twoFa} onToggle={() => setTwoFa((v) => !v)} />
          </View>
        </View>

        <Text style={styles.groupTitle}>Devices</Text>
        <View style={styles.card}>
          {devices.map((d, i, arr) => (
            <View key={d.id} style={[styles.row, i < arr.length - 1 && styles.rowBorder]}>
              <View style={styles.rowIcon}><Smartphone size={18} color={Colors.secondary} strokeWidth={2} /></View>
              <View style={styles.rowBody}><Text style={styles.label}>{d.name}{d.current ? ' (this device)' : ''}</Text><Text style={styles.sub}>{d.lastSeen}</Text></View>
              {!d.current && <Pressable hitSlop={8} onPress={() => setDevices((ds) => ds.filter((x) => x.id !== d.id))} accessibilityRole="button" accessibilityLabel={`Revoke ${d.name}`}><Text style={styles.revoke}>Revoke</Text></Pressable>}
            </View>
          ))}
          {devices.length === 1 && <Text style={styles.allRevoked}>No other active devices.</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={[styles.switch, on && styles.switchOn]} accessibilityRole="switch" accessibilityState={{ checked: on }}>
      <View style={[styles.knob, on && styles.knobOn]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: 60 },
  groupTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  rowIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1 },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  revoke: { ...Typography.labelMd, color: Colors.error },
  allRevoked: { ...Typography.labelSm, color: Colors.onSurfaceVariant, paddingVertical: Spacing.md },
  switch: { width: 48, height: 28, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHighest, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: Colors.secondary },
  knob: { width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.white },
  knobOn: { alignSelf: 'flex-end' },
});
