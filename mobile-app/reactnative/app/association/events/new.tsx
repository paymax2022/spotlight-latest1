import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useAdminAccess } from '@/features/association/hooks';
import { createEvent } from '@/features/association/api/authoring.api';
import { alertAsync } from '@/lib/confirm';
import DatePickerField from '@/components/DatePickerField';
import TimePickerField from '@/components/TimePickerField';
import AddressAutocompleteInput from '@/components/AddressAutocompleteInput';
import { pickDocument } from '@/features/association/utils';
import { uploadLogo, LogoUploadsUnavailableError } from '@/features/association/api/logoUpload.api';
import { describeLogoUploadFailure } from '@/features/association/api/logoUploadError';
import { ImagePlus } from 'lucide-react-native';

function toIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return null;
  if (!/^\d{2}:\d{2}$/.test(time.trim())) return null;
  const d = new Date(`${date.trim()}T${time.trim()}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function NewEventScreen() {
  const access = useAdminAccess();
  const orgId = access.data?.isAdmin ? access.data.organisationId ?? undefined : undefined;

  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [locationPicked, setLocationPicked] = useState(false);
  // Banner: the object key is what gets submitted; the preview is the local file
  // the organiser just picked (the uploaded object isn't publicly fetchable).
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [paid, setPaid] = useState(false);
  const [fee, setFee] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const startsAt = toIso(date, time);
  const titleError = title.trim().length < 3 ? 'Give the event a title' : undefined;
  const whenError = !date.trim() || !time.trim()
    ? 'Set a date and time'
    : !startsAt
      ? 'Use YYYY-MM-DD and HH:mm'
      : new Date(startsAt) <= new Date()
        ? 'Pick a time in the future'
        : undefined;
  // avoids a round trip to be told something the form already knows.
  const feeKobo = Math.round(Number(fee.replace(/[^0-9.]/g, '') || '0') * 100);
  const feeError = paid && feeKobo <= 0 ? 'Set a ticket price' : undefined;
  const valid = !titleError && !whenError && !feeError && !coverUploading && !coverError;

  const onCover = async () => {
    const f = await pickDocument();
    if (!f) return;
    setCoverError(null);
    setCoverUploading(true);
    setCoverPreview(f.uri);
    setCoverKey(null);
    try {
      setCoverKey(await uploadLogo(f.uri, f.name));
    } catch (err) {
      setCoverPreview(null);
      setCoverError(
        err instanceof LogoUploadsUnavailableError
          ? 'Image upload is not available on this server yet.'
          : `That image couldn't be uploaded${describeLogoUploadFailure(err) ? ` — failed ${describeLogoUploadFailure(err)}` : ''}. Try another image.`,
      );
    } finally {
      setCoverUploading(false);
    }
  };

  const removeCover = () => { setCoverKey(null); setCoverPreview(null); setCoverError(null); };

  const submit = async () => {
    setTouched(true);
    if (!valid || !orgId || !startsAt || saving) return;
    setSaving(true);
    try {
      await createEvent(orgId, {
        title: title.trim(),
        description: description.trim() || null,
        startsAt,
        location: location.trim() || null,
        coverUrl: coverKey,
        paid,
        feeKobo: paid ? feeKobo : 0,
        notify: true,
      });
      await alertAsync({ title: 'Event created', message: 'Members have been notified. You can invite people from the event.' });
      router.back();
    } catch {
      await alertAsync({ title: "Couldn't create the event", message: 'Please check the details and try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (access.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="New event" />
        <StateView kind="loading" message="Checking your access…" />
      </SafeAreaView>
    );
  }
  if (!orgId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="New event" />
        <StateView kind="empty" icon="ShieldAlert" title="Admins only" message="Only an organisation admin can create events." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="New event" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextInputField label="Title" placeholder="e.g. Annual general meeting" value={title} onChangeText={setTitle} error={touched ? titleError : undefined} />
        <Text style={styles.label}>Banner (optional)</Text>
        <Pressable onPress={onCover} accessibilityRole="button" accessibilityLabel="Upload event banner">
          <View style={[styles.banner, coverError ? styles.bannerErrored : null]}>
            {coverUploading ? <ActivityIndicator color={Colors.primary} /> :
              coverPreview ? <Image source={{ uri: coverPreview }} style={styles.bannerImg} resizeMode="cover" /> : (
                <View style={styles.bannerEmpty}>
                  <ImagePlus size={24} color={Colors.primary} strokeWidth={2} />
                  <Text style={styles.bannerHint}>Tap to add a banner</Text>
                </View>
              )}
          </View>
        </Pressable>
        {coverError ? <Text style={styles.error}>{coverError}</Text> : null}
        {coverPreview && !coverUploading ? (
          <Pressable onPress={removeCover} accessibilityRole="button" accessibilityLabel="Remove banner">
            <Text style={styles.removeLink}>Remove banner</Text>
          </Pressable>
        ) : null}

        <View style={styles.row}>
          <View style={styles.rowItem}>
            <DatePickerField
              label="Date"
              value={date}
              onChange={setDate}
              minYear={new Date().getFullYear()}
              maxYear={new Date().getFullYear() + 3}
            />
          </View>
          <View style={styles.rowItem}>
            <TimePickerField label="Time" value={time} onChange={setTime} />
          </View>
        </View>
        {touched && whenError ? <Text style={styles.error}>{whenError}</Text> : null}

        <View>
          <Text style={styles.label}>Location (optional)</Text>
          <AddressAutocompleteInput
            value={location}
            onChangeText={(t) => { setLocation(t); setLocationPicked(false); }}
            onSelect={(a) => { setLocation(a.label); setLocationPicked(true); }}
            placeholder="Search for a venue or address"
            resolved={locationPicked}
            enableCurrentLocation={false}
            inlineDropdown
          />
        </View>
        <TextInputField label="Details (optional)" placeholder="What is happening, who should come" value={description} onChangeText={setDescription} multiline numberOfLines={3} />

        <Text style={styles.label}>Tickets</Text>
        <View style={styles.row}>
          {[{ v: false, l: 'Free' }, { v: true, l: 'Paid' }].map(({ v, l }) => {
            const active = paid === v;
            return (
              <Pressable key={l} onPress={() => setPaid(v)} style={[styles.chip, active && styles.chipActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{l}</Text>
              </Pressable>
            );
          })}
        </View>
        {paid ? (
          <TextInputField label="Ticket price (₦)" placeholder="5000" value={fee} onChangeText={setFee} keyboardType="decimal-pad" error={touched ? feeError : undefined} />
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label={saving ? 'Creating…' : 'Create event'} onPress={submit} disabled={saving || (touched && !valid)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.sm, paddingTop: Spacing.sm },
  label: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  error: { ...Typography.labelSm, color: Colors.error },
  row: { flexDirection: 'row', gap: Spacing.sm },
  rowItem: { flex: 1 },
  chip: {
    flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest,
  },
  chipActive: { borderColor: Colors.primary },
  chipText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  chipTextActive: { color: Colors.primary },
  banner: { width: '100%', aspectRatio: 3, maxHeight: 180, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bannerErrored: { borderWidth: 1.5, borderColor: Colors.error },
  bannerImg: { width: '100%', height: '100%' },
  bannerEmpty: { alignItems: 'center', gap: 4 },
  bannerHint: { ...Typography.labelSm, color: Colors.secondary },
  removeLink: { ...Typography.labelMd, color: Colors.error },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
