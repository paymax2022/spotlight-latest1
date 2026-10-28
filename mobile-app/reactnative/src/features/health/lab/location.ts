// Device position for the phlebotomist's route. Never throws: a denied permission,
// a disabled service or a timeout all simply mean "no position", and the server
// treats distance and live location as optional.
import * as Location from 'expo-location';

export interface DevicePosition {
  lat: number;
  lng: number;
}

/**
 * @param ask  true prompts for permission (use on an explicit tap such as "Start
 *             route"); false only reads a position when permission is already granted.
 */
export async function getDevicePosition(ask: boolean): Promise<DevicePosition | undefined> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && ask && perm.canAskAgain) {
      perm = await Location.requestForegroundPermissionsAsync();
    }
    if (!perm.granted) return undefined;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return undefined;
  }
}
