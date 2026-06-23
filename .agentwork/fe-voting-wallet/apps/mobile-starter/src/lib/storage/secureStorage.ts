import * as SecureStore from 'expo-secure-store';

export async function getSecureItem(key: string) {
  return SecureStore.getItemAsync(key);
}

export async function setSecureItem(key: string, value: string) {
  return SecureStore.setItemAsync(key, value);
}

export async function deleteSecureItem(key: string) {
  return SecureStore.deleteItemAsync(key);
}
