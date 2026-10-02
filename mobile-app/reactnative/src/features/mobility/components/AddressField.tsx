import React, { useState } from 'react';
import { View } from 'react-native';
import AddressAutocompleteInput, { type SelectedAddress } from '@/components/AddressAutocompleteInput';

interface Props {
  initial: string;
  near: { lat: number; lng: number };
  placeholder: string;
  onSelect: (a: SelectedAddress) => void;
  surface?: 'checkout' | 'delivery';
  currentLocation?: boolean;
  minHeight?: number;
}

/** Google address autocomplete (no map) that owns its own text state. The
 *  minHeight leaves room for the absolutely-positioned suggestion dropdown. */
export default function AddressField({ initial, near, placeholder, onSelect, surface = 'delivery', currentLocation, minHeight = 420 }: Props) {
  const [text, setText] = useState(initial);
  return (
    <View style={{ minHeight }}>
      <AddressAutocompleteInput
        value={text}
        onChangeText={setText}
        onSelect={onSelect}
        near={near}
        surface={surface}
        enableMapConfirm={false}
        enableCurrentLocation={!!currentLocation}
        placeholder={placeholder}
      />
    </View>
  );
}
