import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Modal, Pressable, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import ProfileMenuItem from '@/components/ProfileMenuItem';
import StateView from '@/components/StateView';
import { useSettings, useUpdateSettings } from '@/features/fx/hooks/useFxAccount';
import { CURRENCIES, CURRENCY_ORDER } from '@/features/fx/constants/fx.constants';
import type { FxSettings } from '@/features/fx/types/fx.types';

// Languages offered for the app UI. FxSettings.language stores the label string.
const LANGUAGES = ['English', 'Nigerian Pidgin', 'Yorùbá', 'Hausa', 'Igbo', 'Français', 'Kiswahili'];

type PickerField = 'defaultCurrency' | 'displayRate' | 'language' | 'theme';
interface PickerConfig {
  title: string;
  field: PickerField;
  options: { value: string; label: string }[];
  selected: string;
}

export default function FxSettingsScreen() {
  const { data, isLoading } = useSettings();
  const update = useUpdateSettings();
  const [picker, setPicker] = useState<PickerConfig | null>(null);

  const confirmLogout = () => Alert.alert('Log out', 'Log out of Spotlight?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: () => router.replace('/(auth)/login') }]);
  const confirmDelete = () => Alert.alert('Delete account', 'This permanently deletes your account and data. This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => {} }]);

  const openCurrency = () => data && setPicker({
    title: 'Default currency', field: 'defaultCurrency', selected: data.defaultCurrency,
    options: CURRENCY_ORDER.map((code) => ({ value: code, label: `${CURRENCIES[code].flag}  ${code} · ${CURRENCIES[code].name}` })),
  });
  const openRate = () => data && setPicker({
    title: 'Display rate', field: 'displayRate', selected: data.displayRate,
    options: [{ value: 'all_in', label: 'All-in (rate includes fees)' }, { value: 'mid', label: 'Mid-market (fees shown separately)' }],
  });
  const openLanguage = () => data && setPicker({
    title: 'Language', field: 'language', selected: data.language,
    options: LANGUAGES.map((l) => ({ value: l, label: l })),
  });
  const openTheme = () => data && setPicker({
    title: 'Theme', field: 'theme', selected: data.theme,
    options: [{ value: 'system', label: 'System default' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
  });

  const onSelect = (value: string) => {
    if (picker) update.mutate({ [picker.field]: value } as Partial<FxSettings>);
    setPicker(null);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Settings" />
      {isLoading || !data ? <StateView kind="loading" /> : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Group title="Account">
            <ProfileMenuItem icon="User" label="Profile" onPress={() => router.push('/(tabs)/profile')} />
            <Divider />
            <ProfileMenuItem icon="Building2" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Business & team" onPress={() => router.push('/fx/business')} />
            <Divider />
            <ProfileMenuItem icon="Gauge" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Limits & tier" onPress={() => router.push('/fx/settings/limits')} />
          </Group>

          <Group title="Preferences">
            <ProfileMenuItem icon="Coins" label="Default currency" value={CURRENCIES[data.defaultCurrency]?.code ?? data.defaultCurrency ?? '—'} onPress={openCurrency} />
            <Divider />
            <ProfileMenuItem icon="Percent" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Display rate" value={data.displayRate === 'all_in' ? 'All-in' : 'Mid-market'} onPress={openRate} />
            <Divider />
            <ProfileMenuItem icon="Bell" label="Notifications" onPress={() => router.push('/fx/settings/notifications')} />
            <Divider />
            <ProfileMenuItem icon="Languages" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Language" value={data.language} onPress={openLanguage} />
            <Divider />
            <ProfileMenuItem icon="Palette" label="Theme" value={data.theme === 'system' ? 'System' : data.theme === 'dark' ? 'Dark' : 'Light'} onPress={openTheme} />
          </Group>

          <Group title="Security & assets">
            <ProfileMenuItem icon="Fingerprint" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Security (biometric, 2FA, devices)" onPress={() => router.push('/fx/settings/security')} />
            <Divider />
            <ProfileMenuItem icon="Wallet" iconColor={Colors.teal} bgColor={Colors.iconBgTeal} label="Linked stablecoin addresses" value={`${data.stablecoinAddresses?.length ?? 0}`} onPress={() => router.push('/fx/settings/stablecoin')} />
          </Group>

          <Group title="Support">
            <ProfileMenuItem icon="CircleHelp" label="Help & FAQ" onPress={() => router.push('/services/support')} />
            <Divider />
            <ProfileMenuItem icon="Headphones" iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} label="Contact support" onPress={() => router.push('/services/support')} />
          </Group>

          <Group>
            <ProfileMenuItem icon="LogOut" label="Log out" danger showChevron={false} onPress={confirmLogout} />
            <Divider />
            <ProfileMenuItem icon="Trash2" label="Delete account" danger showChevron={false} onPress={confirmDelete} />
          </Group>
        </ScrollView>
      )}

      <OptionSheet picker={picker} onSelect={onSelect} onClose={() => setPicker(null)} />
    </SafeAreaView>
  );
}

function OptionSheet({ picker, onSelect, onClose }: { picker: PickerConfig | null; onSelect: (v: string) => void; onClose: () => void }) {
  return (
    <Modal visible={!!picker} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{picker?.title}</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>
        </View>
        <FlatList
          data={picker?.options ?? []}
          keyExtractor={(o) => o.value}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const selected = item.value === picker?.selected;
            return (
              <Pressable onPress={() => onSelect(item.value)} style={[styles.option, selected && styles.optionSelected]} accessibilityRole="button">
                <Text style={[styles.optionText, selected && styles.optionTextSelected]} numberOfLines={1}>{item.label}</Text>
                {selected && <Check size={16} color={Colors.primary} strokeWidth={2.5} />}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <>
      {title ? <Text style={styles.section}>{title}</Text> : <View style={{ height: Spacing.lg }} />}
      <View style={styles.group}>{children}</View>
    </>
  );
}
function Divider() { return <View style={styles.divider} />; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.xxl },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.lg, marginBottom: Spacing.sm, paddingHorizontal: Spacing.containerMargin },
  group: { marginHorizontal: Spacing.containerMargin, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  divider: { height: 1, backgroundColor: Colors.surfaceContainerLow, marginLeft: Spacing.containerMargin + 40 + Spacing.md },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, paddingBottom: 40, maxHeight: '72%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginTop: Spacing.sm, marginBottom: Spacing.xs },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  sheetTitle: { ...Typography.titleMd, color: Colors.onSurface },
  listContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerLow },
  optionSelected: { backgroundColor: Colors.primaryFixed, marginHorizontal: -Spacing.md, paddingHorizontal: Spacing.md, borderRadius: Radius.md },
  optionText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1, marginRight: Spacing.sm },
  optionTextSelected: { color: Colors.primary, fontWeight: '700' },
});
