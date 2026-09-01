import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { BedDouble, CalendarDays, Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import StateView from '@/components/StateView';
import {
  usePropertyDetail, useRoomTypes, useCreateRoomType, useRatePlans, useCreateRatePlan,
  useHotelierReservations,
} from '@/features/stayshotelier/hooks';
import type { RoomType } from '@/features/stayshotelier/types';

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

const RATE_PLAN_TYPES = ['BAR', 'NON_REFUNDABLE', 'BREAKFAST', 'MOBILE_ONLY', 'LOS_DISCOUNT', 'EARLY_BIRD', 'LAST_MINUTE'];
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft — add rooms & rates, then request review to go live',
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
  label, value, onChangeText, placeholder, keyboardType,
}: { label: string; value: string; onChangeText: (t: string) => void; placeholder?: string; keyboardType?: 'default' | 'numeric' | 'decimal-pad' }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value} onChangeText={onChangeText} placeholder={placeholder} keyboardType={keyboardType}
        placeholderTextColor={Colors.outline} style={styles.input}
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
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  inlineRow: { flexDirection: 'row', gap: Spacing.sm },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.outlineVariant,
  },
  itemName: { color: Colors.onSurface, fontSize: 15, fontWeight: '600' as const },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
