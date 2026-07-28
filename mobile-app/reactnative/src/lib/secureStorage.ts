import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const webPrefix = 'paymax_secure_';

function webStorage() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  return window.localStorage;
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  const storage = webStorage();
  if (storage) {
    storage.setItem(`${webPrefix}${key}`, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function getSecureItem(key: string): Promise<string | null> {
  const storage = webStorage();
  if (storage) return storage.getItem(`${webPrefix}${key}`);
  return SecureStore.getItemAsync(key);
}

export async function deleteSecureItem(key: string): Promise<void> {
  const storage = webStorage();
  if (storage) {
    storage.removeItem(`${webPrefix}${key}`);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
