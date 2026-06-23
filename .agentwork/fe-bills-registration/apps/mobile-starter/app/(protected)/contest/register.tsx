// @ts-nocheck
/**
 * Contestant Registration — 3-step wizard.
 * Stitch screen: "Contestant Registration" (19318a8f2a6b489380cb80a1eb9a0c58)
 *
 * Step 1: Personal Info (name, stage name, category, location, bio)
 * Step 2: Upload Performance (photo placeholder — R2 presigned URL wired server-side)
 * Step 3: Review & Submit
 */
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Alert, Image, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StatusBar, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';

import { api } from '@/api/client';

import { GlassCard } from '@/components/voting/GlassCard';
import { VoteButton } from '@/components/voting/VoteButton';
import {
  GLASS_BORDER, votingColors, votingRadius, votingSpacing, votingTypography,
} from '@/theme/voting';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FormState {
  fullName: string;
  stageName: string;
  category: string;
  location: string;
  bio: string;
  photoUri: string | null;
}

const CATEGORIES = ['Vocalist', 'Dance', 'Comedy', 'Magic', 'Spoken Word', 'Talent'];
const LOCATIONS = ['Lagos', 'Abuja', 'Port Harcourt', 'Kano', 'Ibadan', 'Enugu'];

const STEPS = [
  { label: 'Personal Info', icon: 'person-outline' },
  { label: 'Upload Performance', icon: 'camera-outline' },
  { label: 'Review & Submit', icon: 'checkmark-circle-outline' },
] as const;

// ─── Step Indicator ──────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: votingSpacing.margin, paddingVertical: votingSpacing.md }}>
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <View key={step.label} style={{ flexDirection: 'row', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : undefined }}>
            <View style={{
              width: 32, height: 32, borderRadius: 16,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: done ? votingColors.emerald.DEFAULT : active ? votingColors.gold.DEFAULT : votingColors.bg.elevated,
              borderWidth: 1.5,
              borderColor: done ? votingColors.emerald.DEFAULT : active ? votingColors.gold.DEFAULT : GLASS_BORDER,
            }}>
              {done
                ? <Ionicons name="checkmark" size={16} color="#fff" />
                : <Text style={[votingTypography.labelSm, { color: active ? votingColors.gold.on : votingColors.onSurfaceMuted }]}>{i + 1}</Text>
              }
            </View>
            {i < STEPS.length - 1 && (
              <View style={{ flex: 1, height: 1.5, marginHorizontal: 6, backgroundColor: done ? votingColors.emerald.DEFAULT : GLASS_BORDER }} />
            )}
          </View>
        );
      })}
    </View>
  );
}

// ─── Field helpers ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted, letterSpacing: 1 }]}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function TextBox({
  value, onChangeText, placeholder, multiline, keyboardType,
}: { value: string; onChangeText: (v: string) => void; placeholder: string; multiline?: boolean; keyboardType?: any }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={votingColors.onSurfaceMuted}
      multiline={multiline}
      keyboardType={keyboardType}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        backgroundColor: votingColors.bg.card,
        borderRadius: votingRadius.md,
        borderWidth: 1.5,
        borderColor: focused ? votingColors.indigo.DEFAULT : GLASS_BORDER,
        color: votingColors.onSurface,
        paddingHorizontal: votingSpacing.md,
        paddingVertical: votingSpacing.sm,
        minHeight: multiline ? 96 : undefined,
        textAlignVertical: multiline ? 'top' : undefined,
        ...votingTypography.bodyMd,
      }}
    />
  );
}

function Selector({ value, onSelect, options, placeholder }: { value: string; onSelect: (v: string) => void; options: string[]; placeholder: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: votingColors.bg.card, borderRadius: votingRadius.md,
          borderWidth: 1.5, borderColor: open ? votingColors.indigo.DEFAULT : GLASS_BORDER,
          paddingHorizontal: votingSpacing.md, paddingVertical: votingSpacing.sm,
        }}
      >
        <Text style={[votingTypography.bodyMd, { color: value ? votingColors.onSurface : votingColors.onSurfaceMuted }]}>
          {value || placeholder}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={votingColors.onSurfaceMuted} />
      </Pressable>
      {open && (
        <View style={{ marginTop: 4, backgroundColor: votingColors.bg.elevated, borderRadius: votingRadius.md, borderWidth: 1, borderColor: GLASS_BORDER, overflow: 'hidden' }}>
          {options.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => { onSelect(opt); setOpen(false); }}
              style={({ pressed }) => ({
                paddingHorizontal: votingSpacing.md, paddingVertical: votingSpacing.sm,
                backgroundColor: pressed || opt === value ? 'rgba(242,202,80,0.10)' : 'transparent',
                borderBottomWidth: 1, borderBottomColor: GLASS_BORDER,
              })}
            >
              <Text style={[votingTypography.bodyMd, { color: opt === value ? votingColors.gold.DEFAULT : votingColors.onSurface }]}>{opt}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Steps ───────────────────────────────────────────────────────────────────

function Step1({ form, update }: { form: FormState; update: (k: keyof FormState, v: any) => void }) {
  return (
    <View style={{ gap: votingSpacing.lg }}>
      <View>
        <Text style={[votingTypography.headlineMd, { color: votingColors.onSurface }]}>Apply for the Spotlight</Text>
        <Text style={[votingTypography.bodyMd, { color: votingColors.onSurfaceMuted, marginTop: 4 }]}>
          Join the next generation of talent. Complete your profile to get started.
        </Text>
      </View>

      <Field label="Full Name">
        <TextBox value={form.fullName} onChangeText={(v) => update('fullName', v)} placeholder="Your legal name" />
      </Field>

      <Field label="Stage Name">
        <TextBox value={form.stageName} onChangeText={(v) => update('stageName', v)} placeholder="Name the world knows you by" />
      </Field>

      <Field label="Category">
        <Selector value={form.category} onSelect={(v) => update('category', v)} options={CATEGORIES} placeholder="Select your talent category" />
      </Field>

      <Field label="Location">
        <Selector value={form.location} onSelect={(v) => update('location', v)} options={LOCATIONS} placeholder="Select your city" />
      </Field>

      <Field label="Bio">
        <TextBox value={form.bio} onChangeText={(v) => update('bio', v)} placeholder="Tell the world about yourself and your talent…" multiline />
      </Field>
    </View>
  );
}

function Step2({ form, update }: { form: FormState; update: (k: keyof FormState, v: any) => void }) {
  return (
    <View style={{ gap: votingSpacing.lg }}>
      <View>
        <Text style={[votingTypography.headlineMd, { color: votingColors.onSurface }]}>Upload Performance</Text>
        <Text style={[votingTypography.bodyMd, { color: votingColors.onSurfaceMuted, marginTop: 4 }]}>
          Add a photo that represents you. Videos can be uploaded after registration.
        </Text>
      </View>

      {/* Photo upload area */}
      <Pressable
        onPress={() => Alert.alert('Photo Upload', 'Camera roll picker will open here when native permissions are wired.')}
        style={{
          height: 200, borderRadius: votingRadius.xl,
          borderWidth: 2, borderColor: GLASS_BORDER, borderStyle: 'dashed',
          backgroundColor: votingColors.bg.card,
          alignItems: 'center', justifyContent: 'center', gap: votingSpacing.sm,
          overflow: 'hidden',
        }}
      >
        {form.photoUri ? (
          <Image source={{ uri: form.photoUri }} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: votingColors.bg.elevated, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="camera-outline" size={28} color={votingColors.gold.DEFAULT} />
            </View>
            <Text style={[votingTypography.labelMd, { color: votingColors.onSurfaceMuted }]}>Tap to choose a photo</Text>
            <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>JPG, PNG · Max 5MB</Text>
          </>
        )}
      </Pressable>

      {/* Tips card */}
      <GlassCard>
        <Text style={[votingTypography.labelMd, { color: votingColors.gold.DEFAULT, marginBottom: 8 }]}>Photo Tips</Text>
        {[
          'Use a clear, well-lit image of your face',
          'Avoid group photos — solo shots only',
          'High resolution increases your visibility',
        ].map((tip) => (
          <View key={tip} style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
            <Ionicons name="checkmark-circle" size={16} color={votingColors.emerald.DEFAULT} style={{ marginTop: 2 }} />
            <Text style={[votingTypography.bodyMd, { color: votingColors.onSurfaceMuted, flex: 1 }]}>{tip}</Text>
          </View>
        ))}
      </GlassCard>
    </View>
  );
}

function Step3({ form }: { form: FormState }) {
  const rows = [
    { label: 'Full Name', value: form.fullName || '—' },
    { label: 'Stage Name', value: form.stageName || '—' },
    { label: 'Category', value: form.category || '—' },
    { label: 'Location', value: form.location || '—' },
  ];
  return (
    <View style={{ gap: votingSpacing.lg }}>
      <View>
        <Text style={[votingTypography.headlineMd, { color: votingColors.onSurface }]}>Review & Submit</Text>
        <Text style={[votingTypography.bodyMd, { color: votingColors.onSurfaceMuted, marginTop: 4 }]}>
          Confirm your details before we submit your application.
        </Text>
      </View>

      <GlassCard glow>
        {rows.map((row, i) => (
          <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: i < rows.length - 1 ? 1 : 0, borderBottomColor: GLASS_BORDER }}>
            <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted }]}>{row.label.toUpperCase()}</Text>
            <Text style={[votingTypography.bodyMd, { color: votingColors.onSurface, maxWidth: '60%', textAlign: 'right' }]}>{row.value}</Text>
          </View>
        ))}
      </GlassCard>

      {form.bio ? (
        <GlassCard>
          <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted, marginBottom: 6 }]}>BIO</Text>
          <Text style={[votingTypography.bodyMd, { color: votingColors.onSurface, lineHeight: 24 }]}>{form.bio}</Text>
        </GlassCard>
      ) : null}

      <GlassCard>
        <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted, marginBottom: 4 }]}>PHOTO</Text>
        <Text style={[votingTypography.bodyMd, { color: form.photoUri ? votingColors.emerald.DEFAULT : votingColors.onSurfaceMuted }]}>
          {form.photoUri ? '✓ Photo attached' : 'No photo — you can add one later'}
        </Text>
      </GlassCard>

      {/* Terms */}
      <Text style={[votingTypography.labelSm, { color: votingColors.onSurfaceMuted, textAlign: 'center', lineHeight: 18 }]}>
        By continuing, you agree to the{' '}
        <Text style={{ color: votingColors.gold.DEFAULT }}>Spotlight Terms of Service</Text>.
      </Text>
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

async function submitRegistration(form: FormState, contestSlug: string) {
  const response = await api.post('/api/registration/applications', {
    contestSlug,
    accountData: {
      full_name: form.fullName,
      stage_name: form.stageName,
      category: form.category,
      location: form.location,
      bio: form.bio,
      photo_uri: form.photoUri,
    },
  });
  return response.data?.data ?? response.data;
}

export default function ContestRegistrationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ contestSlug?: string; contestId?: string }>();
  const contestSlug = params.contestSlug ?? params.contestId ?? 'open-mic';

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({
    fullName: '', stageName: '', category: '', location: '', bio: '', photoUri: null,
  });

  const submit = useMutation({
    mutationFn: () => submitRegistration(form, contestSlug),
    onSuccess: () => {
      Alert.alert(
        'Application Submitted!',
        'Your application is under review. We\'ll notify you within 48 hours.',
        [{ text: 'Back to Contests', onPress: () => router.dismissAll() }],
      );
    },
    onError: (err: any) => {
      const msg = err?.message ?? 'Submission failed. Please try again.';
      Alert.alert('Submission Failed', msg);
    },
  });

  function update(key: keyof FormState, value: any) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validateStep(): string | null {
    if (step === 0) {
      if (!form.fullName.trim()) return 'Please enter your full name.';
      if (!form.category) return 'Please select a category.';
    }
    return null;
  }

  function onNext() {
    const err = validateStep();
    if (err) { Alert.alert('Missing info', err); return; }
    if (step < 2) { setStep(step + 1); return; }
    submit.mutate();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: votingColors.bg.base }}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: votingSpacing.md, paddingHorizontal: votingSpacing.margin, paddingTop: votingSpacing.sm, borderBottomWidth: 1, borderBottomColor: GLASS_BORDER, paddingBottom: votingSpacing.sm }}>
        <Pressable onPress={step > 0 ? () => setStep(step - 1) : () => router.back()} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="arrow-back" size={22} color={votingColors.onSurface} />
        </Pressable>
        <Text style={[votingTypography.headlineSm, { color: votingColors.onSurface, flex: 1 }]}>
          Step {step + 1} of {STEPS.length} — {STEPS[step].label}
        </Text>
      </View>

      {/* Step indicator */}
      <StepIndicator current={step} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: votingSpacing.margin, paddingBottom: 48, gap: votingSpacing.lg }}
        >
          {step === 0 && <Step1 form={form} update={update} />}
          {step === 1 && <Step2 form={form} update={update} />}
          {step === 2 && <Step3 form={form} />}

          <VoteButton
            title={submit.isPending ? 'Submitting…' : step === 2 ? 'Submit Application' : `Next: ${STEPS[step + 1]?.label}`}
            size="lg"
            loading={submit.isPending}
            onPress={onNext}
          />

          {step === 1 && (
            <VoteButton
              title="Skip for now"
              variant="ghost"
              onPress={() => setStep(2)}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
