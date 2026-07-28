import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Bell, Camera, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';

export default function KycPermissionsScreen() {
  const [camera, setCamera] = useState(false);
  const [notifications, setNotifications] = useState(false);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Permissions" subtitle="Step 2 of 4" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>We need a couple of permissions to verify you and keep you updated.</Text>

        <PermissionCard
          icon={<Camera size={22} color={Colors.secondary} strokeWidth={2} />}
          title="Camera" body="To photograph your ID document and capture a liveness selfie."
          granted={camera} onGrant={() => setCamera(true)} required
        />
        <PermissionCard
          icon={<Bell size={22} color={Colors.secondary} strokeWidth={2} />}
          title="Notifications" body="To alert you on verification updates, rate alerts and payout status."
          granted={notifications} onGrant={() => setNotifications(true)}
        />
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Continue" onPress={() => router.push('/fx/kyc/identity')} disabled={!camera} />
        {!camera ? <Text style={styles.hint}>Camera access is required to verify your identity.</Text> : null}
      </SafeAreaView>
    </SafeAreaView>
  );
}

function PermissionCard({ icon, title, body, granted, onGrant, required }: { icon: React.ReactNode; title: string; body: string; granted: boolean; onGrant: () => void; required?: boolean }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardIcon}>{icon}</View>
      <View style={styles.cardBody}>
        <View style={styles.titleRow}>
          <Text style={styles.cardTitle}>{title}</Text>
          {required ? <Text style={styles.req}>Required</Text> : null}
        </View>
        <Text style={styles.cardText}>{body}</Text>
      </View>
      {granted ? (
        <View style={styles.granted}><Check size={16} color={Colors.teal} strokeWidth={2.5} /></View>
      ) : (
        <PrimaryButton label="Allow" onPress={onGrant} variant="secondary" fullWidth={false} style={styles.allowBtn} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  cardIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  req: { ...Typography.caption, color: Colors.error, fontWeight: '600' },
  cardText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  granted: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  allowBtn: { height: 40, paddingHorizontal: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.xs },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
