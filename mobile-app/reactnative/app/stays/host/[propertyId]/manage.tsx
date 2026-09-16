import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { BedDouble, CalendarDays, CheckCircle2, Circle, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import StateView from '@/components/StateView';
import { alertAsync } from '@/lib/confirm';
import { useCurrentLocation } from '@/features/location/useCurrentLocation';
import PhotoGrid from '@/features/stayshotelier/components/PhotoGrid';
import {
  usePropertyDetail, useRoomTypes, useCreateRoomType, useRatePlans, useCreateRatePlan,
  useHotelierReservations, useUpdatePropertyContent, useUpdatePropertyDetails,
  useVerificationStatus, useSubmitForReview,
} from '@/features/stayshotelier/hooks';
import {
  PROPERTY_TYPES, AMENITY_CATALOG, CANCELLATION_POLICIES,
  type RoomType, type PropertyDetail, type CancellationPolicy, type PropertyTypeValue,
} from '@/features/stayshotelier/types';

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

const TYPE_LABEL: Record<PropertyTypeValue, string> = {
  hotel: 'Hotel', apartment: 'Apartment', shortlet: 'Shortlet',
  guesthouse: 'Guesthouse', villa: 'Villa', resort: 'Resort', hostel: 'Hostel',
};

const RATE_PLAN_TYPES = ['BAR', 'NON_REFUNDABLE', 'BREAKFAST', 'MOBILE_ONLY', 'LOS_DISCOUNT', 'EARLY_BIRD', 'LAST_MINUTE'];
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft — add rooms, rates & photos, then request review to go live',
  PENDING_REVIEW: 'Pending review — Paymax is checking your listing',
  ACTIVE: 'Live — bookable now',
  SUSPENDED: 'Suspended',
};

export default function ManagePropertyScreen() {
  const { propertyId } = useLocalSearchParams<{ propertyId: string }>();
  const detail = usePropertyDetail(propertyId);
  const roomTypes = useRoomTypes(propertyId);
  const ratePlans = useRatePlans(propertyId);
  const reservations = useHotelierReservations(propertyId);

  if (detail.isLoading) {
    return (
      <Shell><StateView kind="loading" title="Loading property" /></Shell>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Shell>
        <StateView kind="error" title="Couldn't load property" actionLabel="Retry" onAction={() => detail.refetch()} />
      </Shell>
    );
  }
  const property = detail.data;

  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* Property summary */}
        <Card>
          <Text style={styles.cardTitle}>{property.name}</Text>
          <Text style={styles.muted}>{property.propertyType} · {property.address}, {property.city}</Text>
          <Text style={styles.statusLine}>{STATUS_LABEL[property.status] ?? property.status}</Text>
        </Card>

        {/* Go-live checklist */}
        <Text style={styles.section}>Go live</Text>
        <VerificationCard propertyId={propertyId} propertyStatus={property.status} />

        {/* Photos */}
        <Text style={styles.section}>Photos</Text>
        <Card>
          <PhotoGrid propertyId={propertyId} />
        </Card>

        {/* Basics & description */}
        <Text style={styles.section}>Listing basics</Text>
        <BasicsEditor propertyId={propertyId} property={property} />

        {/* Location */}
        <Text style={styles.section}>Location</Text>
        <LocationEditor propertyId={propertyId} property={property} />

        {/* Amenities */}
        <Text style={styles.section}>Amenities</Text>
        <AmenitiesEditor propertyId={propertyId} amenities={property.amenities} />

        {/* Policies */}
        <Text style={styles.section}>Policies</Text>
        <PoliciesEditor propertyId={propertyId} property={property} />

        {/* Reservations */}
        <View style={styles.rowBetween}>
          <Text style={styles.section}>Reservations</Text>
        </View>
        <Card>
          {reservations.isLoading ? (
            <Text style={styles.muted}>Loading…</Text>
          ) : !reservations.data || reservations.data.length === 0 ? (
            <View style={styles.emptyRow}>
              <CalendarDays size={18} color={Colors.onSurfaceVariant} />
              <Text style={styles.muted}>No reservations yet.</Text>
            </View>
          ) : (
            reservations.data.map((r) => (
              <View key={r.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>{r.guestName || 'Guest'}</Text>
                  <Text style={styles.muted}>{r.checkIn} → {r.checkOut} · {r.state}</Text>
                </View>
                <Text style={styles.itemName}>{naira(r.totalKobo)}</Text>
              </View>
            ))
          )}
        </Card>

        {/* Room types */}
        <Text style={styles.section}>Room types</Text>
        <RoomTypeBuilder propertyId={propertyId} roomTypes={roomTypes.data ?? []} loading={roomTypes.isLoading} />

        {/* Rate plans */}
        <Text style={styles.section}>Rates</Text>
        <RatePlanBuilder
          propertyId={propertyId}
          roomTypes={roomTypes.data ?? []}
          ratePlans={ratePlans.data ?? []}
          onCreated={() => ratePlans.refetch()}
        />
      </ScrollView>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Manage property" />
      {children}
    </SafeAreaView>
  );
}

// ── Go-live checklist ────────────────────────────────────────────────────────
function VerificationCard({ propertyId, propertyStatus }: { propertyId: string; propertyStatus: string }) {
  const vs = useVerificationStatus(propertyId);
  const submit = useSubmitForReview(propertyId);

  if (vs.isLoading) return <Card><Text style={styles.muted}>Loading checklist…</Text></Card>;
  if (vs.isError || !vs.data) return <Card><Text style={styles.muted}>Couldn't load your go-live checklist.</Text></Card>;

  const requiredRemaining = vs.data.checklist.filter((c) => c.required && c.status !== 'approved');
  const canSubmit = requiredRemaining.length === 0 && propertyStatus === 'DRAFT';

  const submitForReview = () => {
    submit.mutate(undefined, {
      onError: (e) => alertAsync({ title: 'Could not submit', message: e instanceof Error ? e.message : 'Complete every required step first.' }),
      onSuccess: () => alertAsync({ title: 'Submitted', message: 'Paymax will review your listing shortly.' }),
    });
  };

  return (
    <Card>
      {vs.data.checklist.map((item) => (
        <View key={item.key} style={styles.checkRow}>
          {item.status === 'approved' ? (
            <CheckCircle2 size={17} color={Colors.primary} />
          ) : (
            <Circle size={17} color={Colors.outlineVariant} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.checkLabel}>{item.label}{item.required ? '' : ' (optional)'}</Text>
            {item.detail ? <Text style={styles.muted}>{item.detail}</Text> : null}
          </View>
        </View>
      ))}
      {propertyStatus === 'DRAFT' ? (
        <PrimaryButton
          label={submit.isPending ? 'Submitting…' : 'Submit for review'}
          onPress={submitForReview}
          loading={submit.isPending}
          disabled={!canSubmit}
        />
      ) : (
        <Text style={styles.muted}>{STATUS_LABEL[propertyStatus] ?? propertyStatus}</Text>
      )}
    </Card>
  );
}

// ── Basics & description ────────────────────────────────────────────────────
function BasicsEditor({ propertyId, property }: { propertyId: string; property: PropertyDetail }) {
  const [name, setName] = useState(property.name);
  const [description, setDescription] = useState(property.description);
  const [propertyType, setPropertyType] = useState(property.propertyType as PropertyTypeValue);
  const [starRating, setStarRating] = useState(String(property.starRating || ''));
  const update = useUpdatePropertyContent(propertyId);

  useEffect(() => {
    setName(property.name); setDescription(property.description);
    setPropertyType(property.propertyType as PropertyTypeValue); setStarRating(String(property.starRating || ''));
  }, [property.name, property.description, property.propertyType, property.starRating]);

  const save = () => {
    const star = Number(starRating);
    update.mutate(
      { name, description, propertyType, starRating: Number.isFinite(star) ? star : undefined },
      { onError: () => alertAsync({ title: "Couldn't save", message: 'Check your connection and try again.' }) },
    );
  };

  return (
    <Card>
      <Field label="Property name" value={name} onChangeText={setName} placeholder="Sunset Shortlets Lekki" />
      <Field
        label="Description" value={description} onChangeText={setDescription} multiline
        placeholder="Tell guests what makes this place special — the space, the neighbourhood, standout amenities."
      />
      <SelectField
        label="Property type"
        value={TYPE_LABEL[propertyType] ?? propertyType}
        options={PROPERTY_TYPES.map((t) => TYPE_LABEL[t])}
        onChange={(label) => {
          const found = PROPERTY_TYPES.find((t) => TYPE_LABEL[t] === label);
          if (found) setPropertyType(found);
        }}
        searchable={false}
      />
      <Field label="Star rating (0–5)" value={starRating} onChangeText={setStarRating} placeholder="4" keyboardType="numeric" />
      <PrimaryButton label="Save" onPress={save} loading={update.isPending} disabled={!name.trim()} />
    </Card>
  );
}

// ── Location ─────────────────────────────────────────────────────────────────
function LocationEditor({ propertyId, property }: { propertyId: string; property: PropertyDetail }) {
  const [address, setAddress] = useState(property.address);
  const [city, setCity] = useState(property.city);
  const [lat, setLat] = useState(property.lat || 0);
  const [lng, setLng] = useState(property.lng || 0);
  const updateContent = useUpdatePropertyContent(propertyId);
  const updateDetails = useUpdatePropertyDetails(propertyId);
  const loc = useCurrentLocation();

  useEffect(() => {
    setAddress(property.address); setCity(property.city); setLat(property.lat || 0); setLng(property.lng || 0);
  }, [property.address, property.city, property.lat, property.lng]);

  const useMyLocation = async () => {
    const resolved = await loc.getCurrent();
    if (!resolved) {
      if (loc.error) alertAsync({ title: 'Could not get your location', message: loc.error });
      return;
    }
    setLat(resolved.lat); setLng(resolved.lng);
    if (!address.trim()) setAddress(resolved.label);
  };

  const save = async () => {
    try {
      await updateContent.mutateAsync({ address, city });
      if (lat && lng) await updateDetails.mutateAsync({ lat, lng });
    } catch {
      alertAsync({ title: "Couldn't save", message: 'Check your connection and try again.' });
    }
  };

  const saving = updateContent.isPending || updateDetails.isPending;

  return (
    <Card>
      <Field label="Address" value={address} onChangeText={setAddress} placeholder="12 Admiralty Way" />
      <Field label="City" value={city} onChangeText={setCity} placeholder="Lagos" />
      <Pressable style={styles.locationBtn} onPress={useMyLocation} disabled={loc.loading || !loc.available}>
        <MapPin size={15} color={Colors.primary} />
        <Text style={styles.locationBtnText}>
          {loc.loading ? 'Getting your location…' : lat && lng ? `Pinned: ${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'Use my current location'}
        </Text>
      </Pressable>
      <PrimaryButton label="Save" onPress={save} loading={saving} disabled={!address.trim() || !city.trim()} />
    </Card>
  );
}

// ── Amenities ────────────────────────────────────────────────────────────────
function AmenitiesEditor({ propertyId, amenities }: { propertyId: string; amenities: string[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(amenities));
  const update = useUpdatePropertyDetails(propertyId);

  useEffect(() => { setSelected(new Set(amenities)); }, [amenities]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const save = () => {
    update.mutate({ amenities: Array.from(selected) }, {
      onError: () => alertAsync({ title: "Couldn't save", message: 'Check your connection and try again.' }),
    });
  };

  return (
    <Card>
      {AMENITY_CATALOG.map((group) => (
        <View key={group.group} style={{ gap: Spacing.xs }}>
          <Text style={styles.amenityGroup}>{group.group}</Text>
          <View style={styles.chipRow}>
            {group.items.map((item) => {
              const on = selected.has(item.key);
              return (
                <Pressable key={item.key} onPress={() => toggle(item.key)} style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      <PrimaryButton label="Save amenities" onPress={save} loading={update.isPending} />
    </Card>
  );
}

// ── Policies ─────────────────────────────────────────────────────────────────
function PoliciesEditor({ propertyId, property }: { propertyId: string; property: PropertyDetail }) {
  const [checkInFrom, setCheckInFrom] = useState(property.checkInFrom);
  const [checkOutUntil, setCheckOutUntil] = useState(property.checkOutUntil);
  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicy>(property.cancellationPolicy);
  const [houseRules, setHouseRules] = useState(property.houseRules);
  const [contactPhone, setContactPhone] = useState(property.contactPhone);
  const [contactEmail, setContactEmail] = useState(property.contactEmail);
  const update = useUpdatePropertyDetails(propertyId);

  useEffect(() => {
    setCheckInFrom(property.checkInFrom); setCheckOutUntil(property.checkOutUntil);
    setCancellationPolicy(property.cancellationPolicy); setHouseRules(property.houseRules);
    setContactPhone(property.contactPhone); setContactEmail(property.contactEmail);
  }, [property.checkInFrom, property.checkOutUntil, property.cancellationPolicy, property.houseRules, property.contactPhone, property.contactEmail]);

  const timeValid = (v: string) => /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
  const canSave = timeValid(checkInFrom) && timeValid(checkOutUntil);

  const save = () => {
    update.mutate(
      { checkInFrom, checkOutUntil, cancellationPolicy, houseRules, contactPhone, contactEmail },
      { onError: () => alertAsync({ title: "Couldn't save", message: 'Check that check-in/out are HH:MM and try again.' }) },
    );
  };

  const policyLabel = CANCELLATION_POLICIES.find((p) => p.value === cancellationPolicy)?.label ?? cancellationPolicy;

  return (
    <Card>
      <View style={styles.inlineRow}>
        <View style={{ flex: 1 }}>
          <Field label="Check-in from" value={checkInFrom} onChangeText={setCheckInFrom} placeholder="14:00" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Check-out until" value={checkOutUntil} onChangeText={setCheckOutUntil} placeholder="12:00" />
        </View>
      </View>
      <SelectField
        label="Cancellation policy"
        value={policyLabel}
        options={CANCELLATION_POLICIES.map((p) => p.label)}
        onChange={(label) => {
          const found = CANCELLATION_POLICIES.find((p) => p.label === label);
          if (found) setCancellationPolicy(found.value);
        }}
        searchable={false}
      />
      <Text style={styles.muted}>{CANCELLATION_POLICIES.find((p) => p.value === cancellationPolicy)?.description}</Text>
      <Field label="House rules" value={houseRules} onChangeText={setHouseRules} multiline placeholder="No smoking. No parties. Quiet hours after 10pm." />
      <Field label="Contact phone" value={contactPhone} onChangeText={setContactPhone} placeholder="+234 801 234 5678" keyboardType="default" />
      <Field label="Contact email" value={contactEmail} onChangeText={setContactEmail} placeholder="frontdesk@yourproperty.ng" />
      <PrimaryButton label="Save policies" onPress={save} loading={update.isPending} disabled={!canSave} />
    </Card>
  );
}

function RoomTypeBuilder({ propertyId, roomTypes, loading }: { propertyId: string; roomTypes: RoomType[]; loading: boolean }) {
  const [name, setName] = useState('');
  const [occupancy, setOccupancy] = useState('2');
  const [bedding, setBedding] = useState('');
  const create = useCreateRoomType(propertyId);

  const add = () => {
    const occ = Number(occupancy);
    if (!name.trim() || !Number.isFinite(occ) || occ <= 0) return;
    create.mutate({ name: name.trim(), occupancy: occ, bedding: bedding.trim() }, {
      onSuccess: () => { setName(''); setOccupancy('2'); setBedding(''); },
    });
  };

  return (
    <View style={{ gap: Spacing.md }}>
      {loading ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : roomTypes.length === 0 ? (
        <Text style={styles.muted}>No room types yet. Add one below — a shortlet apartment can be a single room type.</Text>
      ) : (
        roomTypes.map((rt) => (
          <Card key={rt.id}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{rt.name}</Text>
                <Text style={styles.muted}>Sleeps {rt.occupancy}{rt.bedding ? ` · ${rt.bedding}` : ''}</Text>
              </View>
              <BedDouble size={18} color={Colors.primary} />
            </View>
          </Card>
        ))
      )}

      <Card>
        <Text style={styles.cardTitle}>Add a room type</Text>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Studio Apartment" />
        <View style={styles.inlineRow}>
          <View style={{ flex: 1 }}>
            <Field label="Sleeps" value={occupancy} onChangeText={setOccupancy} placeholder="2" keyboardType="numeric" />
          </View>
          <View style={{ flex: 2 }}>
            <Field label="Bedding" value={bedding} onChangeText={setBedding} placeholder="1 Queen bed" />
          </View>
        </View>
        <PrimaryButton label="Add room type" onPress={add} loading={create.isPending} disabled={!name.trim()} />
      </Card>
    </View>
  );
}

function RatePlanBuilder({
  propertyId, roomTypes, ratePlans, onCreated,
}: {
  propertyId: string;
  roomTypes: RoomType[];
  ratePlans: { id: string; roomTypeId: string; type: string; refundable: boolean; baseSellRateKobo: number }[];
  /** Belt-and-suspenders alongside the hook's own cache invalidation — called
   *  after a successful create so the list is guaranteed to reflect it without
   *  needing a manual reload. */
  onCreated: () => void;
}) {
  const [roomTypeId, setRoomTypeId] = useState('');
  const [type, setType] = useState('BAR');
  const [refundable, setRefundable] = useState(true);
  const [priceNaira, setPriceNaira] = useState('');
  const create = useCreateRatePlan(propertyId);

  const roomTypeById = Object.fromEntries(roomTypes.map((rt) => [rt.id, rt.name]));
  const price = Number(priceNaira);
  const canAdd = roomTypeId !== '' && Number.isFinite(price) && price > 0;

  const add = () => {
    if (!canAdd) return;
    create.mutate(
      { roomTypeId, type, refundable, baseSellRateKobo: Math.round(price * 100) },
      { onSuccess: () => { setPriceNaira(''); onCreated(); } },
    );
  };

  if (roomTypes.length === 0) {
    return <Text style={styles.muted}>Add a room type above before setting rates.</Text>;
  }

  return (
    <View style={{ gap: Spacing.md }}>
      {ratePlans.length === 0 ? (
        <Text style={styles.muted}>No rates yet.</Text>
      ) : (
        ratePlans.map((rp) => (
          <Card key={rp.id}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{roomTypeById[rp.roomTypeId] ?? 'Room'} · {rp.type}</Text>
                <Text style={styles.muted}>{rp.refundable ? 'Refundable' : 'Non-refundable'}</Text>
              </View>
              <Text style={styles.itemName}>{naira(rp.baseSellRateKobo)}/night</Text>
            </View>
          </Card>
        ))
      )}

      <Card>
        <Text style={styles.cardTitle}>Add a rate</Text>
        <SelectField
          label="Room type"
          value={roomTypeById[roomTypeId] ?? ''}
          options={roomTypes.map((rt) => rt.name)}
          onChange={(label) => {
            const found = roomTypes.find((rt) => rt.name === label);
            if (found) setRoomTypeId(found.id);
          }}
          searchable={false}
        />
        <SelectField label="Rate type" value={type} options={RATE_PLAN_TYPES} onChange={setType} searchable={false} />
        <Field label="Price per night (₦)" value={priceNaira} onChangeText={setPriceNaira} placeholder="45000" keyboardType="decimal-pad" />
        <View style={styles.rowBetween}>
          <Text style={styles.label}>Refundable</Text>
          <Switch value={refundable} onValueChange={setRefundable} trackColor={{ true: Colors.primary, false: Colors.outlineVariant }} />
        </View>
        <PrimaryButton label="Add rate" onPress={add} loading={create.isPending} disabled={!canAdd} />
      </Card>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Field({
  label, value, onChangeText, placeholder, keyboardType, multiline,
}: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad'; multiline?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder} keyboardType={keyboardType}
        placeholderTextColor={Colors.outline} style={[styles.input, multiline && styles.inputMultiline]}
        multiline={multiline} numberOfLines={multiline ? 4 : 1}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xxl },
  section: { color: Colors.onSurface, fontSize: 16, fontWeight: '700' as const, marginTop: Spacing.sm },
  card: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md,
    gap: Spacing.sm, borderWidth: 1, borderColor: Colors.outlineVariant,
  },
  cardTitle: { color: Colors.onSurface, fontSize: 16, fontWeight: '700' as const },
  muted: { color: Colors.onSurfaceVariant, fontSize: 13 },
  statusLine: { ...Typography.labelSm, color: Colors.secondary, marginTop: 2 },
  label: { color: Colors.onSurfaceVariant, fontSize: 13, fontWeight: '600' as const },
  input: {
    borderWidth: 1, borderColor: Colors.outlineVariant, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 10, color: Colors.onSurface, fontSize: 15,
    backgroundColor: Colors.background,
  },
  inputMultiline: { minHeight: 84, textAlignVertical: 'top' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  inlineRow: { flexDirection: 'row', gap: Spacing.sm },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
  itemName: { color: Colors.onSurface, fontSize: 15, fontWeight: '600' as const },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  checkLabel: { color: Colors.onSurface, fontSize: 13.5, fontWeight: '600' as const },
  locationBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  locationBtnText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '600' as const },
  amenityGroup: { color: Colors.onSurfaceVariant, fontSize: 12, fontWeight: '700' as const, textTransform: 'uppercase', letterSpacing: 0.3 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: Spacing.xs },
  chip: {
    paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.background,
  },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, fontWeight: '600' as const },
  chipTextOn: { color: '#FFFFFF' },
});
