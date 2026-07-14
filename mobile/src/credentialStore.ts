// Pairing credentials live in the platform keychain via expo-secure-store.
// SecureStore has no web implementation, so the web target (dev preview /
// demos) falls back to localStorage.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const credentialStore = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') { localStorage.setItem(key, value); return; }
    await SecureStore.setItemAsync(key, value);
  },
  async delete(key: string): Promise<void> {
    if (Platform.OS === 'web') { localStorage.removeItem(key); return; }
    await SecureStore.deleteItemAsync(key);
  },
};
