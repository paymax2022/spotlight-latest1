import React, { useState } from 'react';
import { View, Text, Image, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Camera, X } from 'lucide-react-native';
import { Colors, Radius, Spacing } from '@/constants/tokens';
import { pickStoreImage, uploadStoreImage, StoreImageError } from './storeImageUpload';
import { StoreImageUploadsUnavailableError } from './api';

/**
 * The optional photo for ONE menu item, inside the add-item form.
 *
 * Optional in the truest sense: an item without a picture is complete, so nothing here
 * blocks the owner from adding the food. Tapping picks from the library and uploads
 * immediately (the outlet already exists, so the presign has an id to hang the key on);
 * the parent gets back the object key to send with the item, and keeps a local uri so
 * the preview doesn't wait for the next store re-read.
 */
export default function DishPhotoField({
  storeId, value, uri, onChange,
}: {
  storeId: string;
  /** The object key saved on the item, '' when it has no photo. */
  value: string;
  /** Local preview of the picked file, shown until the item is re-read from the server. */
  uri: string | null;
  onChange: (key: string, uri: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    if (busy) return;
    setError(null);
    try {
      const file = await pickStoreImage('menu');
      if (!file) return; // cancelled
      setBusy(true);
      const key = await uploadStoreImage(storeId, 'menu', file);
      onChange(key, file.uri);
    } catch (e) {
      setError(e instanceof StoreImageError || e instanceof StoreImageUploadsUnavailableError
        ? e.message
        : 'Couldn’t send the picture. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    setError(null);
    onChange('', null);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          onPress={choose}
          style={styles.box}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          accessibilityLabel={uri ? 'Change the item photo' : 'Add an item photo (optional)'}
        >
          {uri ? (
            <Image source={{ uri }} style={styles.img} resizeMode="cover" />
          ) : (
            <View style={styles.empty}>
              <Camera size={18} color={Colors.primary} />
              <Text style={styles.emptyText}>Photo</Text>
            </View>
          )}
          {busy ? <View style={styles.spin}><ActivityIndicator size="small" color="#fff" /></View> : null}
        </Pressable>

        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.label}>Photo (optional)</Text>
          <Text style={styles.hint}>A picture of the dish as customers will receive it.</Text>
          {uri && !busy ? (
            <Pressable onPress={remove} hitSlop={6} accessibilityRole="button" accessibilityLabel="Remove the item photo">
              <View style={styles.removeRow}>
                <X size={13} color={Colors.error} strokeWidth={2.4} />
                <Text style={styles.remove}>Remove photo</Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const BOX = 64;

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  row: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  box: {
    width: BOX, height: BOX, borderRadius: Radius.md, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center', justifyContent: 'center',
  },
  img: { width: '100%', height: '100%' },
  empty: { alignItems: 'center', gap: 2 },
  emptyText: { color: Colors.primary, fontSize: 11, fontWeight: '600' },
  spin: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  label: { color: Colors.onSurface, fontSize: 13, fontWeight: '600' },
  hint: { color: Colors.onSurfaceVariant, fontSize: 12 },
  removeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  remove: { color: Colors.error, fontSize: 12, fontWeight: '600' },
  error: { color: Colors.error, fontSize: 13 },
});
