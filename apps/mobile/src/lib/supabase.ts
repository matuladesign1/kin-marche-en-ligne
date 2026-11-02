import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY doivent être définies (voir .env.example).');
}

// Seule la clé publique est utilisée côté mobile : toutes les données sont
// protégées par la Row Level Security de Supabase.
export const supabase = createClient(url, anonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Lève une erreur lisible si Supabase renvoie une erreur. */
export function unwrap<T>(res: { data: T | null; error: { message: string; details?: string | null; hint?: string | null } | null }): T {
  if (res.error) {
    const err = new Error(res.error.message) as Error & { details?: string | null; hint?: string | null };
    err.details = res.error.details;
    err.hint = res.error.hint;
    throw err;
  }
  return res.data as T;
}
