import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Car, User, FileText, Clock, BookUser, Minus, Plus, ArrowLeftRight, LogIn, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import CodeTypeSelector from '@/features/visitor/components/CodeTypeSelector';
import ContactPickerModal from '@/features/visitor/components/ContactPickerModal';
import RecurrenceEditor from '@/features/visitor/components/RecurrenceEditor';
import { codeTypeMeta } from '@/features/visitor/constants/visitor.constants';
import { useCreateAccessCode, useRestrictionStatus, visitorKeys } from '@/features/visitor/hooks/useVisitor';
import { VisitorApiError } from '@/features/visitor/api/visitor.api';
import type { CodeType, CodeUsageMode } from '@/features/visitor/types/visitor.types';

const VALIDITY_PRESETS: { label: string; hours: number }[] = [
  { label: '2 hrs', hours: 2 },
  { label: '6 hrs', hours: 6 },
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
];

const USAGE_MODES: { key: CodeUsageMode; label: string; sub: string; Icon: typeof LogIn }[] = [
  { key: 'entry_exit', label: 'Entry & Exit', sub: 'Can leave and return', Icon: ArrowLeftRight },
  { key: 'one_time', label: 'One-time', sub: 'Single entry only', Icon: LogIn },
];

function addHoursISO(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

export default function CreateAccessCodeScreen() {
  const qc = useQueryClient();
  const restriction = useRestrictionStatus();
  const createCode = useCreateAccessCode();

  const [codeType, setCodeType] = useState<CodeType>('one_time');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [plate, setPlate] = useState('');
  const [validityHours, setValidityHours] = useState(6);
  const [partySize, setPartySize] = useState(1);
  const [usageMode, setUsageMode] = useState<CodeUsageMode>('one_time');
  const [recurrenceRule, setRecurrenceRule] = useState<string | undefined>(undefined);
  const [showContacts, setShowContacts] = useState(false);
  const [formError, setFormError] = useState('');

  const meta = codeTypeMeta(codeType);
  const needsVehicle = codeType === 'ride_hailing' || codeType === 'delivery';
  const isScheduled = codeType === 'recurring' || codeType === 'domestic_staff';

  // VM-108: if hard-banned, never show the form.
  const hardBanned = restriction.data?.state === 'hard_ban';
  React.useEffect(() => {
    if (hardBanned) router.replace('/visitor/restricted');
  }, [hardBanned]);

  const validityLabel = useMemo(
    () => VALIDITY_PRESETS.find((p) => p.hours === validityHours)?.label ?? `${validityHours} hrs`,
    [validityHours],
  );

  const onSelectType = (t: CodeType) => {
    setCodeType(t);
    const m = codeTypeMeta(t);
    if (m.defaultValidityHours > 0) setValidityHours(m.defaultValidityHours);
    // Reusable code types default to entry+exit; casual ones to one-time.
    setUsageMode(m.reusable ? 'entry_exit' : 'one_time');
  };

  const submit = () => {
    setFormError('');
    if (!name.trim()) {
      setFormError('Please enter the visitor’s name.');
      return;
    }
    createCode.mutate(
      {
        codeType,
        visitorName: name.trim(),
        visitorPhone: phone.trim() || undefined,
        purpose: purpose.trim() || undefined,
        vehiclePlate: plate.trim() || undefined,
        validityStart: new Date().toISOString(),
        validityEnd: addHoursISO(validityHours),
        usageMode,
        partySize,
        recurrenceRule: isScheduled ? recurrenceRule : undefined,
        maxEntries: usageMode === 'one_time' ? 1 : 99,
      },
      {
        onSuccess: (code) => {
          qc.invalidateQueries({ queryKey: visitorKeys.codes() });
          router.replace(`/visitor/code/${code.id}`);
        },
        onError: (e) => {
          if (e instanceof VisitorApiError && e.code === 'PAYMENT_RESTRICTED') {
            router.replace('/visitor/restricted');
            return;
          }
          setFormError(e instanceof Error ? e.message : 'Could not create the code. Please try again.');
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Invite a visitor" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Access type</Text>
          <CodeTypeSelector value={codeType} onChange={onSelectType} maxPhase={2} />

          <View style={styles.form}>
            {/* Visitor name + phonebook */}
            <TextInputField
              label="Visitor name"
              placeholder="e.g. Amaka Obi"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              leftIcon={<User size={18} color={Colors.outline} />}
            />
            <Pressable onPress={() => setShowContacts(true)} accessibilityRole="button" accessibilityLabel="Choose from contacts" style={({ pressed }) => [styles.contactsBtn, pressed && styles.pressed]}>
              <BookUser size={16} color={Colors.secondary} strokeWidth={2} />
              <Text style={styles.contactsText}>Choose from contacts</Text>
            </Pressable>

            <TextInputField
              label="Phone number (optional)"
              placeholder="+234 800 000 0000"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <TextInputField
              label="Purpose (optional)"
              placeholder="e.g. Family visit, package delivery"
              value={purpose}
              onChangeText={setPurpose}
              leftIcon={<FileText size={18} color={Colors.outline} />}
            />
            {needsVehicle ? (
              <TextInputField
                label="Vehicle plate (optional)"
                placeholder="LAS-123-AA"
                value={plate}
                onChangeText={(v) => setPlate(v.toUpperCase())}
                autoCapitalize="characters"
                leftIcon={<Car size={18} color={Colors.outline} />}
              />
            ) : null}
          </View>

          {/* Number of guests */}
          <Text style={styles.label}>Number of guests</Text>
          <View style={styles.stepper}>
            <View style={styles.stepperLeft}>
              <Users size={18} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
              <Text style={styles.stepperText}>{partySize} {partySize === 1 ? 'guest' : 'guests'}</Text>
            </View>
            <View style={styles.stepperBtns}>
              <Pressable onPress={() => setPartySize((n) => Math.max(1, n - 1))} disabled={partySize <= 1} accessibilityRole="button" accessibilityLabel="Fewer guests" style={[styles.stepBtn, partySize <= 1 && styles.stepBtnDisabled]}>
                <Minus size={18} color={partySize <= 1 ? Colors.outline : Colors.primary} strokeWidth={2.2} />
              </Pressable>
              <Pressable onPress={() => setPartySize((n) => Math.min(20, n + 1))} disabled={partySize >= 20} accessibilityRole="button" accessibilityLabel="More guests" style={[styles.stepBtn, partySize >= 20 && styles.stepBtnDisabled]}>
                <Plus size={18} color={partySize >= 20 ? Colors.outline : Colors.primary} strokeWidth={2.2} />
              </Pressable>
            </View>
          </View>

          {/* How the code is used */}
          <Text style={styles.label}>How the code is used</Text>
          <View style={styles.modeRow}>
            {USAGE_MODES.map((m) => {
              const selected = m.key === usageMode;
              const { Icon } = m;
              return (
                <Pressable key={m.key} onPress={() => setUsageMode(m.key)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.mode, selected && styles.modeSelected]}>
                  <Icon size={20} color={selected ? Colors.onPrimary : Colors.secondary} strokeWidth={1.8} />
                  <Text style={[styles.modeLabel, selected && { color: Colors.onPrimary }]}>{m.label}</Text>
                  <Text style={[styles.modeSub, selected && { color: Colors.inverseOnSurface }]}>{m.sub}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Recurring schedule (VM-105) */}
          {isScheduled ? <RecurrenceEditor onChange={setRecurrenceRule} /> : null}

          {/* Validity */}
          <Text style={styles.label}>Valid for</Text>
          <View style={styles.presetRow}>
            {VALIDITY_PRESETS.map((p) => {
              const selected = p.hours === validityHours;
              return (
                <Pressable
                  key={p.label}
                  onPress={() => setValidityHours(p.hours)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[styles.preset, selected && styles.presetSelected]}
                >
                  <Text style={[styles.presetText, selected && styles.presetTextSelected]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.summary}>
            <Clock size={16} color={Colors.onSurfaceVariant} strokeWidth={1.8} />
            <Text style={styles.summaryText}>
              {meta.label} · {partySize} {partySize === 1 ? 'guest' : 'guests'} · {usageMode === 'one_time' ? 'one-time' : 'entry & exit'} · valid {validityLabel}
            </Text>
          </View>

          {formError ? <Text style={styles.error}>{formError}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton label="Generate code" onPress={submit} loading={createCode.isPending} />
        </View>
      </KeyboardAvoidingView>

      <ContactPickerModal
        visible={showContacts}
        onClose={() => setShowContacts(false)}
        onSelect={(c) => { setName(c.name); setPhone(c.phone); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm },
  form: { marginTop: Spacing.sm },
  pressed: { opacity: 0.8 },
  contactsBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: -Spacing.sm, marginBottom: Spacing.md, paddingVertical: 6 },
  contactsText: { ...Typography.labelMd, color: Colors.secondary },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.sm, paddingLeft: Spacing.md },
  stepperLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  stepperText: { ...Typography.labelLg, color: Colors.onSurface },
  stepperBtns: { flexDirection: 'row', gap: Spacing.sm },
  stepBtn: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLowest, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  stepBtnDisabled: { opacity: 0.5 },
  modeRow: { flexDirection: 'row', gap: Spacing.md },
  mode: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
  modeSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  modeLabel: { ...Typography.labelLg, color: Colors.onSurface, marginTop: Spacing.xs },
  modeSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  preset: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.transparent },
  presetSelected: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.secondary },
  presetText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  presetTextSelected: { color: Colors.secondary },
  summary: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.sm },
  summaryText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  error: { ...Typography.labelMd, color: Colors.error, marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, backgroundColor: Colors.background },
});
